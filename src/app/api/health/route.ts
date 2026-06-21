import { db } from "@/db";
import { alerts, notificationLog, userUsage, deadLetterQueue, circuitBreaker } from "@/db/schema";
import { sql, eq, and, count, lt } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const apiKey = process.env.ADMIN_API_KEY;
  if (apiKey) {
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== apiKey) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const start = Date.now();
    const result = await db.execute(sql`SELECT 1 as test`);

    const dbOk = !!(result.rows?.[0]);
    const queryTimeMs = Date.now() - start;

    // Quick summary stats (timeboxed)
    const [activeAlertCount] = await db
      .select({ count: count() })
      .from(alerts)
      .where(and(eq(alerts.active, true), eq(alerts.notified, false)));

    const [stuckProcessingCount] = await db
      .select({ count: count() })
      .from(alerts)
      .where(
        and(
          eq(alerts.processing, true),
          lt(alerts.processingUntil || sql`now()`, new Date())
        )
      );

    const [deadLetterCount] = await db
      .select({ count: count() })
      .from(deadLetterQueue);

    const [userCount] = await db
      .select({ count: count() })
      .from(userUsage);

    const [failedRecent] = await db
      .select({ count: count() })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.status, "failed"),
          sql`${notificationLog.sentAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000)}`
        )
      );

    const circuitBreakers = await db
      .select({ provider: circuitBreaker.provider, state: circuitBreaker.state })
      .from(circuitBreaker)
      .where(sql`${circuitBreaker.state} != 'closed'`);

    return Response.json({
      ok: dbOk,
      queryTimeMs,
      uptime: process.uptime(),
      memory: process.memoryUsage ? Math.round(process.memoryUsage().heapUsed / 1024 / 1024) : null,
      stats: {
        activeAlerts: activeAlertCount.count,
        stuckProcessing: stuckProcessingCount.count,
        deadLetterQueue: deadLetterCount.count,
        totalUsers: userCount.count,
        recentFailures24h: failedRecent.count,
      },
      circuitBreakers: circuitBreakers.length > 0 ? circuitBreakers : "all_closed",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e.message, code: e.code },
      { status: 500 }
    );
  }
}
