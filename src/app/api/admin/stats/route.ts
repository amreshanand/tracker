import { db } from "@/db";
import { products, alerts, availability, notificationLog, analyticsEvents, userUsage, deadLetterQueue, circuitBreaker } from "@/db/schema";
import { count, eq, and, sql, desc, lt } from "drizzle-orm";

export const dynamic = "force-dynamic";

function requireAdmin(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== apiKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    // Core counts
    const [productCount] = await db.select({ count: count() }).from(products);
    const [alertTotal] = await db.select({ count: count() }).from(alerts);
    const [alertActive] = await db
      .select({ count: count() })
      .from(alerts)
      .where(and(eq(alerts.active, true), eq(alerts.notified, false)));
    const [alertNotified] = await db
      .select({ count: count() })
      .from(alerts)
      .where(eq(alerts.notified, true));
    const [alertProcessing] = await db
      .select({ count: count() })
      .from(alerts)
      .where(eq(alerts.processing, true));
    const [stuckProcessing] = await db
      .select({ count: count() })
      .from(alerts)
      .where(and(eq(alerts.processing, true), lt(alerts.processingUntil || sql`now()`, new Date())));
    const [checkCount] = await db.select({ count: count() }).from(availability);
    const [sentCount] = await db
      .select({ count: count() })
      .from(notificationLog)
      .where(eq(notificationLog.status, "sent"));
    const [failedCount] = await db
      .select({ count: count() })
      .from(notificationLog)
      .where(eq(notificationLog.status, "failed"));
    const [pendingCount] = await db
      .select({ count: count() })
      .from(notificationLog)
      .where(eq(notificationLog.status, "pending"));

    // Unique users
    const [uniqueUsers] = await db
      .select({ count: count() })
      .from(userUsage);

    // Dead letter queue
    const [dlqCount] = await db
      .select({ count: count() })
      .from(deadLetterQueue);

    // Circuit breakers
    const openBreakers = await db
      .select({ provider: circuitBreaker.provider, state: circuitBreaker.state })
      .from(circuitBreaker)
      .where(sql`${circuitBreaker.state} != 'closed'`);

    // Conversion funnel (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const funnel = await db
      .select({
        event: analyticsEvents.event,
        count: count(),
      })
      .from(analyticsEvents)
      .where(sql`${analyticsEvents.createdAt} > ${sevenDaysAgo}`)
      .groupBy(analyticsEvents.event)
      .orderBy(sql`count desc`);

    // Email delivery success rate
    const totalSent = sentCount.count + failedCount.count;
    const successRate = totalSent > 0 ? (sentCount.count / totalSent * 100).toFixed(1) : "0";

    // Active users in last 24h (alerts created or triggered)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentCreated] = await db
      .select({ count: count() })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.event, "alert_created"),
        sql`${analyticsEvents.createdAt} > ${dayAgo}`
      ));
    const [recentTriggered] = await db
      .select({ count: count() })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.event, "alert_triggered"),
        sql`${analyticsEvents.createdAt} > ${dayAgo}`
      ));

    return Response.json({
      stats: {
        products: productCount.count,
        alerts: {
          total: alertTotal.count,
          active: alertActive.count,
          notified: alertNotified.count,
          processing: alertProcessing.count,
          stuckProcessing: stuckProcessing.count,
        },
        availability: {
          totalChecks: checkCount.count,
        },
        notifications: {
          sent: sentCount.count,
          failed: failedCount.count,
          pending: pendingCount.count,
          successRate: `${successRate}%`,
        },
        users: {
          total: uniqueUsers.count,
          recentAlertsCreated: recentCreated.count,
          recentAlertsTriggered: recentTriggered.count,
        },
        deadLetterQueue: {
          total: dlqCount.count,
        },
        circuitBreakers: {
          open: openBreakers,
          count: openBreakers.length,
        },
        funnel,
      },
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return Response.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
