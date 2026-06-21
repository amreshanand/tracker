import { db } from "@/db";
import { alerts, products, notificationLog, analyticsEvents, userUsage, deadLetterQueue } from "@/db/schema";
import { checkSinglePincodeAvailability } from "@/lib/availability-service";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";
import { sendAvailabilityNotification, generateAvailabilityEmail } from "@/lib/email-service";
import { eq, and, lt, sql, or, inArray } from "drizzle-orm";
import { cronLog, type CronLogEntry } from "@/lib/cron-log";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RETRIES = 3;
const LOCK_LEASE_MS = 5 * 60 * 1000;
const STALE_LOCK_TIMEOUT_MIN = 30;
const BATCH_LIMIT = 25;
const TIME_BUDGET_MS = 45_000;
const UNVERIFIED_EXPIRY_DAYS = 7;

function generateDeliveryId(alertId: number): string {
  return `${alertId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

async function deactivateAlert(
  alertId: number,
  email: string,
  productId: number,
  pincode?: string | null,
  deliveryId?: string,
  reason?: string,
  lastError?: string,
  retryCount?: number,
) {
  await db
    .update(alerts)
    .set({ active: false, notified: true, processing: false, processingUntil: null })
    .where(eq(alerts.id, alertId));

  await db.insert(deadLetterQueue).values({
    alertId,
    email,
    productId,
    pincode: pincode || null,
    reason: reason || "Permanently failed",
    deliveryId: deliveryId || null,
    lastError: lastError || null,
    retryCount: retryCount ?? 0,
  });
}

async function processAlerts() {
  const log: CronLogEntry = { startedAt: new Date(), processed: 0, notified: 0, failed: 0, retried: 0 };
  const instanceId = `process_${Date.now()}`;

  // Step 1: Acquire distributed cron lock
  const lock = await acquireCronLock("notification_process");
  if (!lock.acquired) {
    log.error = "Could not acquire cron lock — another instance is processing";
    return log;
  }

  try {
    // Step 2: Unlock stale processing locks (alerts stuck in processing beyond lease)
    const staleCutoff = new Date(Date.now() - STALE_LOCK_TIMEOUT_MIN * 60 * 1000);
    await db
      .update(alerts)
      .set({ processing: false, processingUntil: null })
      .where(and(eq(alerts.processing, true), lt(alerts.processingUntil || sql`now()`, staleCutoff)));

    // Step 2b: Expire unverified alerts older than UNVERIFIED_EXPIRY_DAYS
    const expiryCutoff = new Date(Date.now() - UNVERIFIED_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db
      .update(alerts)
      .set({ active: false, notified: true })
      .where(
        and(
          eq(alerts.emailVerified, false),
          eq(alerts.active, false),
          lt(alerts.createdAt || sql`now()`, expiryCutoff)
        )
      );

    // Step 3: Atomically claim alerts with lease-based lock (bounded batch)
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + LOCK_LEASE_MS);

    // Subquery: pick up to BATCH_LIMIT candidate IDs
    const candidates = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.active, true),
          eq(alerts.notified, false),
          or(eq(alerts.emailVerified, true), sql`${alerts.emailVerified} is null`),
          or(eq(alerts.processing, false), lt(alerts.processingUntil || sql`now()`, now))
        )
      )
      .limit(BATCH_LIMIT);

    const claimed = candidates.length > 0
      ? await db
          .update(alerts)
          .set({ processing: true, processingUntil: leaseUntil })
          .where(
            and(
              eq(alerts.active, true),
              eq(alerts.notified, false),
              or(eq(alerts.emailVerified, true), sql`${alerts.emailVerified} is null`),
              or(eq(alerts.processing, false), lt(alerts.processingUntil || sql`now()`, now)),
              inArray(alerts.id, candidates.map(c => c.id))
            )
          )
          .returning({ id: alerts.id })
      : [];

    if (claimed.length === 0) {
      // Step 3b: Retry failed notifications (state machine support)
      const retryLogs = await db
        .select({
          logId: notificationLog.id,
          alertId: notificationLog.alertId,
          productId: notificationLog.productId,
          email: notificationLog.email,
          deliveryId: notificationLog.deliveryId,
          subject: notificationLog.subject,
          body: notificationLog.body,
          retryCount: notificationLog.retryCount,
        })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.status, "failed"),
            lt(notificationLog.retryCount, MAX_RETRIES)
          )
        )
        .limit(20);

      for (const entry of retryLogs) {
        log.retried++;
        try {
          const result = await sendAvailabilityNotification({
            userName: "",
            email: entry.email,
            productName: entry.subject.replace(/^.*?"(.*?)".*$/, "$1"),
            productUrl: "",
            pincode: "",
            city: "",
            state: "",
          });

          const newStatus = result.success ? "sent" : "failed";
          const updates: Record<string, unknown> = {
            status: newStatus,
            retryCount: sql`${notificationLog.retryCount} + 1`,
            lastError: result.success ? null : result.error,
            sentAt: new Date(),
          };

          await db
            .update(notificationLog)
            .set(updates)
            .where(eq(notificationLog.id, entry.logId));

          if (result.success) {
            log.notified++;
            await db
              .update(alerts)
              .set({ notified: true, processing: false, processingUntil: null, notifiedAt: new Date() })
              .where(eq(alerts.id, entry.alertId));
          } else {
            log.failed++;
            // Deactivate and move to dead letter queue if max retries exhausted
            if (entry.retryCount + 1 >= MAX_RETRIES) {
              await deactivateAlert(
                entry.alertId,
                entry.email,
                entry.productId,
                null,
                entry.deliveryId,
                "Max retries exceeded for notification delivery",
                result.error,
                entry.retryCount + 1
              );
            }
          }
        } catch {
          log.failed++;
        }
      }

      return log;
    }

    // Step 4: Fetch claimed alert details
    const activeAlerts = await db
      .select({
        alertId: alerts.id,
        userName: alerts.userName,
        email: alerts.email,
        pincode: alerts.pincode,
        productId: alerts.productId,
        targetPrice: alerts.targetPrice,
        productName: products.name,
        productUrl: products.url,
        productPrice: products.price,
      })
      .from(alerts)
      .innerJoin(products, eq(alerts.productId, products.id))
      .where(eq(alerts.processing, true));

    const startTime = Date.now();
    const analyticsBatch: Array<{ event: string; email: string; productId: number }> = [];

    for (const alert of activeAlerts) {
      // Time budget check — exit early if running out of time
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        if (analyticsBatch.length > 0) {
          await db.insert(analyticsEvents).values(analyticsBatch).catch(() => {});
        }
        await db
          .update(alerts)
          .set({ processing: false, processingUntil: null })
          .where(and(eq(alerts.processing, true), eq(alerts.notified, false)));
        break;
      }

      log.processed++;
      const deliveryId = generateDeliveryId(alert.alertId);

      try {
        const availabilityResult = await checkSinglePincodeAvailability(
          alert.productUrl,
          alert.pincode
        );

        if (availabilityResult.available) {
          // targetPrice enforcement — skip if current price exceeds threshold
          if (alert.targetPrice !== null && alert.productPrice !== null) {
            const currentPrice = parseFloat(alert.productPrice.replace(/[^0-9.]/g, ""));
            if (!isNaN(currentPrice) && currentPrice > alert.targetPrice) {
              await db
                .update(alerts)
                .set({ processing: false, processingUntil: null })
                .where(eq(alerts.id, alert.alertId));
              continue;
            }
          }

          const pincodeDetails = await lookupPincodeFromIndiaPost(alert.pincode);
          const city = pincodeDetails?.district || "Unknown";
          const state = pincodeDetails?.state || "Unknown";

          const emailContent = generateAvailabilityEmail({
            userName: alert.userName,
            productName: alert.productName,
            productUrl: alert.productUrl,
            pincode: alert.pincode,
            city,
            state,
          });

          const emailResult = await sendAvailabilityNotification({
            userName: alert.userName,
            email: alert.email,
            productName: alert.productName,
            productUrl: alert.productUrl,
            pincode: alert.pincode,
            city,
            state,
          });

          const deliveryStatus = emailResult.success ? "sent" : "failed";

          await db.insert(notificationLog).values({
            alertId: alert.alertId,
            productId: alert.productId,
            email: alert.email,
            deliveryId,
            subject: emailContent.subject,
            body: emailContent.text,
            status: deliveryStatus,
            retryCount: 0,
          });

          if (emailResult.success) {
            await db
              .update(alerts)
              .set({ notified: true, processing: false, processingUntil: null, notifiedAt: new Date() })
              .where(eq(alerts.id, alert.alertId));

            await db
              .update(userUsage)
              .set({
                totalNotificationsSent: sql`${userUsage.totalNotificationsSent} + 1`,
                activeAlerts: sql`GREATEST(${userUsage.activeAlerts} - 1, 0)`,
                updatedAt: new Date(),
              })
              .where(eq(userUsage.email, alert.email));

            analyticsBatch.push({
              event: "alert_notified",
              email: alert.email,
              productId: alert.productId,
            });

            log.notified++;
          } else {
            log.failed++;
            await deactivateAlert(alert.alertId, alert.email, alert.productId, alert.pincode, deliveryId, "Initial notification delivery failed", emailResult.error, 0);
          }
        } else {
          // Product not yet available — release lock so next cron cycle can re-check
          await db
            .update(alerts)
            .set({ processing: false, processingUntil: null })
            .where(eq(alerts.id, alert.alertId));
        }
      } catch (error) {
        log.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";

        await db
          .update(alerts)
          .set({
            processing: false,
            processingUntil: null,
            retryCount: sql`${alerts.retryCount} + 1`,
            lastError: errorMsg,
          })
          .where(eq(alerts.id, alert.alertId));

        // Move to dead letter queue if too many failures on this alert
        const [alertRecord] = await db
          .select({ retryCount: alerts.retryCount })
          .from(alerts)
          .where(eq(alerts.id, alert.alertId))
          .limit(1);

        if (alertRecord && alertRecord.retryCount >= MAX_RETRIES) {
          await deactivateAlert(alert.alertId, alert.email, alert.productId, alert.pincode, undefined, `Max retries (${MAX_RETRIES}) exceeded for processing`, errorMsg, alertRecord.retryCount);
        }
      }

      // Renew lease after each alert to prevent timeout on long batches
      await db
        .update(alerts)
        .set({ processingUntil: new Date(Date.now() + LOCK_LEASE_MS) })
        .where(eq(alerts.processing, true));
    }

    // Flush batched analytics
    if (analyticsBatch.length > 0) {
      await db.insert(analyticsEvents).values(analyticsBatch).catch(() => {});
    }

    return log;
  } finally {
    await releaseCronLock("notification_process");
  }
}

export async function GET() {
  const startTime = Date.now();
  try {
    const log = await processAlerts();
    const duration = Date.now() - startTime;

    await cronLog("notification_process", { ...log, durationMs: duration });

    return Response.json({
      message: `Processed ${log.processed} alerts. Notified: ${log.notified}. Failed: ${log.failed}. Retried: ${log.retried}.`,
      results: log,
      configStatus: {
        emailConfigured: !!process.env.RESEND_API_KEY,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    await cronLog("notification_process", {
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: duration,
    });
    console.error("Error processing notifications:", error);
    return Response.json(
      { error: "Failed to process notifications" },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
