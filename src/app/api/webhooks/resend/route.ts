import { db } from "@/db";
import { alerts, userUsage, analyticsEvents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, data } = body;

    // Resend webhook events
    // bounce: { type: "bounce", data: { email, bounce_type, bounce_code, ... } }
    // complaint: { type: "complaint", data: { email, ... } }

    if (!type || !data?.email) {
      return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const email = data.email.toLowerCase().trim();
    const eventType = type === "bounce" ? "bounced" : type === "complaint" ? "complained" : null;

    if (!eventType) {
      return Response.json({ error: `Unsupported event type: ${type}` }, { status: 400 });
    }

    // Deactivate all active alerts for this email
    await db
      .update(alerts)
      .set({ active: false, notified: true })
      .where(eq(alerts.email, email));

    // Mark user as bounced
    await db
      .update(userUsage)
      .set({
        bounced: true,
        bounceReason: data.bounce_code || data.complaint_type || eventType,
        bouncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userUsage.email, email));

    // Log to analytics
    await db.insert(analyticsEvents).values({
      event: `email_${eventType}`,
      email,
      productId: null,
      metadata: JSON.stringify({
        bounceType: data.bounce_type,
        bounceCode: data.bounce_code,
        diagnosticCode: data.diagnostic_code,
        eventType,
      }),
    });

    console.log(`[Webhook] Email ${eventType} for ${email} — all alerts deactivated`);

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return Response.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}
