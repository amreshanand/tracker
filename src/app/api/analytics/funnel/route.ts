import { db } from "@/db";
import { analyticsEvents } from "@/db/schema";
import { count, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const events = await db
      .select({
        event: analyticsEvents.event,
        count: count(),
      })
      .from(analyticsEvents)
      .where(sql`${analyticsEvents.createdAt} > ${sevenDaysAgo}`)
      .groupBy(analyticsEvents.event)
      .orderBy(sql`count desc`);

    const eventMap: Record<string, number> = {};
    for (const e of events) {
      eventMap[e.event] = e.count;
    }

    const funnel = {
      installs: eventMap["install"] || 0,
      popupOpens: eventMap["popup_open"] || 0,
      productsDetected: eventMap["product_detected"] || 0,
      availabilityChecked: eventMap["availability_checked"] || 0,
      alertsCreated: eventMap["alert_created"] || 0,
      alertsTriggered: eventMap["alert_triggered"] || 0,
    };

    const conversionRates = {
      installToPopup: funnel.installs > 0
        ? ((funnel.popupOpens / funnel.installs) * 100).toFixed(1) + "%"
        : "0%",
      popupToDetect: funnel.popupOpens > 0
        ? ((funnel.productsDetected / funnel.popupOpens) * 100).toFixed(1) + "%"
        : "0%",
      detectToCheck: funnel.productsDetected > 0
        ? ((funnel.availabilityChecked / funnel.productsDetected) * 100).toFixed(1) + "%"
        : "0%",
      checkToAlert: funnel.availabilityChecked > 0
        ? ((funnel.alertsCreated / funnel.availabilityChecked) * 100).toFixed(1) + "%"
        : "0%",
      alertToTrigger: funnel.alertsCreated > 0
        ? ((funnel.alertsTriggered / funnel.alertsCreated) * 100).toFixed(1) + "%"
        : "0%",
    };

    return Response.json({ funnel, conversionRates });
  } catch (error) {
    console.error("Error fetching funnel:", error);
    return Response.json(
      { error: "Failed to fetch funnel" },
      { status: 500 }
    );
  }
}
