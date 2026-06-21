import { db } from "@/db";
import { alerts, products, notificationLog } from "@/db/schema";
import { checkSinglePincodeAvailability } from "@/lib/availability-service";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";
import { sendAvailabilityNotification, generateAvailabilityEmail } from "@/lib/email-service";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function processAlerts() {
  const activeAlerts = await db
    .select({
      alertId: alerts.id,
      userName: alerts.userName,
      email: alerts.email,
      pincode: alerts.pincode,
      productId: alerts.productId,
      productName: products.name,
      productUrl: products.url,
    })
    .from(alerts)
    .innerJoin(products, eq(alerts.productId, products.id))
    .where(and(eq(alerts.active, true), eq(alerts.notified, false)));

  const results = {
    processed: 0,
    notified: 0,
    stillUnavailable: 0,
    errors: 0,
    emailProvider: process.env.RESEND_API_KEY ? "resend" : "simulation",
    notifications: [] as Array<{
      alertId: number;
      email: string;
      productName: string;
      pincode: string;
      status: string;
      emailSent: boolean;
      error?: string;
    }>,
  };

  for (const alert of activeAlerts) {
    results.processed++;
    try {
      // Re-check notified flag to avoid race conditions on concurrent runs
      const [freshAlert] = await db
        .select({ notified: alerts.notified })
        .from(alerts)
        .where(eq(alerts.id, alert.alertId))
        .limit(1);
      if (!freshAlert || freshAlert.notified) continue;

      const availabilityResult = await checkSinglePincodeAvailability(
        alert.productUrl,
        alert.pincode
      );

      if (availabilityResult.available) {
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

        await db.insert(notificationLog).values({
          alertId: alert.alertId,
          productId: alert.productId,
          email: alert.email,
          subject: emailContent.subject,
          body: emailContent.text,
          status: emailResult.success ? "sent" : "failed",
        });

        if (emailResult.success) {
          const [updated] = await db
            .update(alerts)
            .set({ notified: true, notifiedAt: new Date() })
            .where(and(eq(alerts.id, alert.alertId), eq(alerts.notified, false)))
            .returning();

          if (!updated) {
            // Another cron run already marked this notified — skip
            results.notifications.push({
              alertId: alert.alertId,
              email: alert.email,
              productName: alert.productName,
              pincode: alert.pincode,
              status: "already_notified",
              emailSent: true,
            });
            continue;
          }

          results.notified++;
          results.notifications.push({
            alertId: alert.alertId,
            email: alert.email,
            productName: alert.productName,
            pincode: alert.pincode,
            status: "notified",
            emailSent: true,
          });
        } else {
          results.errors++;
          results.notifications.push({
            alertId: alert.alertId,
            email: alert.email,
            productName: alert.productName,
            pincode: alert.pincode,
            status: "email_failed",
            emailSent: false,
            error: emailResult.error,
          });
        }
      } else {
        results.stillUnavailable++;
        results.notifications.push({
          alertId: alert.alertId,
          email: alert.email,
          productName: alert.productName,
          pincode: alert.pincode,
          status: "still_unavailable",
          emailSent: false,
        });
      }
    } catch (error) {
      results.errors++;
      results.notifications.push({
        alertId: alert.alertId,
        email: alert.email,
        productName: alert.productName,
        pincode: alert.pincode,
        status: "error",
        emailSent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

export async function GET() {
  try {
    const results = await processAlerts();
    return Response.json({
      message: `Processed ${results.processed} alerts. Notified: ${results.notified}. Still unavailable: ${results.stillUnavailable}.`,
      results,
      configStatus: {
        emailConfigured: !!process.env.RESEND_API_KEY,
        provider: results.emailProvider,
        note: process.env.RESEND_API_KEY
          ? "Emails will be sent via Resend"
          : "No email provider configured. Set RESEND_API_KEY to enable real email notifications.",
      },
    });
  } catch (error) {
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
