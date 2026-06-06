import { db } from "@/db";
import { alerts, products, notificationLog } from "@/db/schema";
import { checkSinglePincodeAvailability } from "@/lib/availability-service";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";
import { sendAvailabilityNotification, generateAvailabilityEmail } from "@/lib/email-service";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Process pending alerts and send notifications
 * 
 * This endpoint simulates the background job that checks alerts
 * In production, this would be called by a cron job (e.g., via Render cron or Vercel cron)
 */
export async function POST() {
  try {
    // Fetch all active, non-notified alerts
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
        // Check real availability
        const availabilityResult = await checkSinglePincodeAvailability(
          alert.productUrl,
          alert.pincode
        );

        // Get real pincode details
        const pincodeDetails = await lookupPincodeFromIndiaPost(alert.pincode);

        if (availabilityResult.available) {
          // Product is now available! Send notification
          const city = pincodeDetails?.district || "Unknown";
          const state = pincodeDetails?.state || "Unknown";

          // Generate email content
          const emailContent = generateAvailabilityEmail({
            userName: alert.userName,
            productName: alert.productName,
            productUrl: alert.productUrl,
            pincode: alert.pincode,
            city,
            state,
          });

          // Try to send actual email
          const emailResult = await sendAvailabilityNotification({
            userName: alert.userName,
            email: alert.email,
            productName: alert.productName,
            productUrl: alert.productUrl,
            pincode: alert.pincode,
            city,
            state,
          });

          // Log the notification
          await db.insert(notificationLog).values({
            alertId: alert.alertId,
            productId: alert.productId,
            email: alert.email,
            subject: emailContent.subject,
            body: emailContent.text,
            status: emailResult.success ? "sent" : "failed",
          });

          // Mark alert as notified
          await db
            .update(alerts)
            .set({ notified: true, notifiedAt: new Date() })
            .where(eq(alerts.id, alert.alertId));

          results.notified++;
          results.notifications.push({
            alertId: alert.alertId,
            email: alert.email,
            productName: alert.productName,
            pincode: alert.pincode,
            status: "notified",
            emailSent: emailResult.success,
            error: emailResult.error,
          });
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
