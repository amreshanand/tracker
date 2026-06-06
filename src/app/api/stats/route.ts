import { db } from "@/db";
import { products, alerts, availability, notificationLog } from "@/db/schema";
import { count, eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [productCount] = await db.select({ count: count() }).from(products);
    const [alertCount] = await db.select({ count: count() }).from(alerts);
    const [activeAlertCount] = await db
      .select({ count: count() })
      .from(alerts)
      .where(and(eq(alerts.active, true), eq(alerts.notified, false)));
    const [notifiedCount] = await db
      .select({ count: count() })
      .from(alerts)
      .where(eq(alerts.notified, true));
    const [availabilityCount] = await db
      .select({ count: count() })
      .from(availability);
    const [notificationCount] = await db
      .select({ count: count() })
      .from(notificationLog);

    return Response.json({
      stats: {
        products: productCount.count,
        totalAlerts: alertCount.count,
        activeAlerts: activeAlertCount.count,
        notifiedAlerts: notifiedCount.count,
        availabilityChecks: availabilityCount.count,
        notificationsSent: notificationCount.count,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return Response.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
