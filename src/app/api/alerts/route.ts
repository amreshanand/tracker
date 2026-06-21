import { db } from "@/db";
import { alerts, products, userUsage, analyticsEvents } from "@/db/schema";
import { detectPlatform } from "@/lib/platform";
import { eq, desc, and, sql } from "drizzle-orm";
import { emailAlertLimiter, getClientIp } from "@/lib/rate-limit";
import { checkIdempotency, saveIdempotencyResponse } from "@/lib/idempotency";
import { sendEmail } from "@/lib/email-service";
import { isDisposableEmail } from "@/lib/disposable-emails";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const FREE_TIER_MAX_ALERTS = 5;
const MAX_REQUEST_BODY_BYTES = 4096;
const MAX_USERNAME_LENGTH = 100;
const MAX_METADATA_LENGTH = 2000;

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function generateVerificationToken(): string {
  return crypto.randomUUID();
}

async function sendVerificationEmail(email: string, token: string, baseUrl: string, productName: string) {
  const verifyUrl = `${baseUrl}/api/alerts/verify?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Verify your email for Product Availability Tracker",
    html: `
      <h2>Verify your email address</h2>
      <p>You've created an availability alert for <strong>${productName}</strong>.</p>
      <p>Click the link below to verify your email and activate the alert:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px;">Verify Email & Activate Alert</a></p>
      <p>If you didn't create this alert, you can ignore this email.</p>
    `,
    text: `Verify your email for Product Availability Tracker\n\nYou've created an availability alert for ${productName}.\n\nClick this link to verify your email and activate the alert:\n${verifyUrl}\n\nIf you didn't create this alert, ignore this email.`,
  });
}

export async function POST(request: Request) {
  try {
    // Request size limit
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_BODY_BYTES) {
      return Response.json({ error: "Request body too large" }, { status: 413 });
    }

    const body = await request.json();
    const { userName, email, pincode, productUrl, productName, targetPrice, idempotencyKey } = body;

    // Idempotency check
    if (idempotencyKey) {
      const idemp = await checkIdempotency(idempotencyKey);
      if (!idemp.isNew && idemp.existingResponse) {
        return Response.json(
          idemp.existingResponse.body as Record<string, unknown>,
          { status: idemp.existingResponse.status }
        );
      }
    }

    if (!userName || !email || !pincode || !productUrl) {
      return Response.json(
        { error: "Name, email, pincode, and product URL are required" },
        { status: 400 }
      );
    }

    if (typeof userName !== "string" || userName.length > MAX_USERNAME_LENGTH || userName.length < 1) {
      return Response.json({ error: "Name must be 1-100 characters" }, { status: 400 });
    }

    if (typeof email !== "string" || email.length > 254) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Invalid email address format" }, { status: 400 });
    }

    if (isDisposableEmail(email)) {
      return Response.json({ error: "Disposable email addresses are not allowed" }, { status: 400 });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return Response.json(
        { error: "Invalid pincode. Must be 6 digits." },
        { status: 400 }
      );
    }

    if (productUrl.length > 2000) {
      return Response.json({ error: "Product URL too long" }, { status: 400 });
    }

    if (productName && (typeof productName !== "string" || productName.length > 500)) {
      return Response.json({ error: "Product name too long" }, { status: 400 });
    }

    if (targetPrice && (isNaN(parseFloat(targetPrice)) || parseFloat(targetPrice) <= 0)) {
      return Response.json({ error: "Invalid target price" }, { status: 400 });
    }

    // Per-email rate limiting
    const ip = getClientIp(request);
    const emailLimit = await emailAlertLimiter.check(`alert:${email}:${ip}`);
    if (!emailLimit.allowed) {
      return Response.json(
        { error: `Too many alert creations. Try again in ${emailLimit.retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfter) } }
      );
    }

    // Ensure product exists
    let productRecord = await db
      .select()
      .from(products)
      .where(eq(products.url, productUrl))
      .limit(1);

    if (productRecord.length === 0) {
      const platform = detectPlatform(productUrl);
      productRecord = await db
        .insert(products)
        .values({
          name: productName || "Unknown Product",
          url: productUrl,
          platform,
        })
        .returning();
    }

    const product = productRecord[0];

    // Check free tier limit
    const [usage] = await db
      .select({ activeAlerts: userUsage.activeAlerts, plan: userUsage.plan })
      .from(userUsage)
      .where(eq(userUsage.email, email))
      .limit(1);

    const activeCount = usage?.activeAlerts ?? 0;
    if (usage?.plan === "free" && activeCount >= FREE_TIER_MAX_ALERTS) {
      const resp = { error: `Free plan limited to ${FREE_TIER_MAX_ALERTS} active alerts. Upgrade for unlimited.` };
      if (idempotencyKey) await saveIdempotencyResponse(idempotencyKey, 403, resp);
      return Response.json(resp, { status: 403 });
    }

    // Check existing alert (dedup: email + product + pincode)
    const existingAlert = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.email, email),
          eq(alerts.productId, product.id),
          eq(alerts.pincode, pincode)
        )
      )
      .limit(1);

    if (existingAlert.length > 0) {
      if (!existingAlert[0].active) {
        const wasVerified = existingAlert[0].emailVerified !== false;
        if (wasVerified) {
          await db
            .update(alerts)
            .set({ active: true, notified: false })
            .where(eq(alerts.id, existingAlert[0].id));
        } else {
          const token = generateVerificationToken();
          await db
            .update(alerts)
            .set({ verificationToken: token, notified: false })
            .where(eq(alerts.id, existingAlert[0].id));
          const baseUrl = getBaseUrl(request);
          sendVerificationEmail(email, token, baseUrl, productName || "product");
        }
      }
      const resp = {
        alert: existingAlert[0],
        message: "Alert already exists for this product and pincode",
        alreadyExists: true,
      };
      if (idempotencyKey) await saveIdempotencyResponse(idempotencyKey, 200, resp);
      return Response.json(resp);
    }

    // Create alert (pending email verification)
    const verificationToken = generateVerificationToken();
    const traceId = crypto.randomUUID();
    const [newAlert] = await db
      .insert(alerts)
      .values({
        userName,
        email,
        pincode,
        productId: product.id,
        targetPrice: targetPrice ? parseFloat(targetPrice) : null,
        emailVerified: false,
        active: false,
        verificationToken,
        traceId,
      })
      .returning();

    // Update user usage counters
    await db
      .insert(userUsage)
      .values({
        email,
        activeAlerts: 1,
        totalAlertsCreated: 1,
      })
      .onConflictDoUpdate({
        target: userUsage.email,
        set: {
          activeAlerts: sql`${userUsage.activeAlerts} + 1`,
          totalAlertsCreated: sql`${userUsage.totalAlertsCreated} + 1`,
          updatedAt: new Date(),
        },
      });

    // Send verification email (fire-and-forget)
    const baseUrl = getBaseUrl(request);
    sendVerificationEmail(email, verificationToken, baseUrl, product.name);

    // Track analytics + lifecycle event
    await db.insert(analyticsEvents).values({
      event: "alert_created",
      email,
      productId: product.id,
      metadata: JSON.stringify({ platform: product.platform, pincode, hasTargetPrice: !!targetPrice, traceId }),
    });

    const resp = {
      alert: { ...newAlert, verificationToken: undefined },
      message: "Alert created! Please check your email to verify and activate the alert.",
      alreadyExists: false,
      emailVerificationRequired: true,
      usage: { activeAlerts: activeCount + 1, plan: usage?.plan || "free" },
    };

    if (idempotencyKey) await saveIdempotencyResponse(idempotencyKey, 200, resp);
    return Response.json(resp);
  } catch (error) {
    console.error("Error creating alert:", error);
    return Response.json(
      { error: "Failed to create alert" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    let query = db
      .select({
        id: alerts.id,
        userName: alerts.userName,
        email: alerts.email,
        pincode: alerts.pincode,
        targetPrice: alerts.targetPrice,
        notified: alerts.notified,
        active: alerts.active,
        createdAt: alerts.createdAt,
        notifiedAt: alerts.notifiedAt,
        productId: alerts.productId,
        productName: products.name,
        productUrl: products.url,
        platform: products.platform,
        productPrice: products.price,
      })
      .from(alerts)
      .innerJoin(products, eq(alerts.productId, products.id))
      .orderBy(desc(alerts.createdAt))
      .limit(100);

    if (email) {
      query = query.where(eq(alerts.email, email)) as typeof query;
    }

    const allAlerts = await query;

    return Response.json({ alerts: allAlerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return Response.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}
