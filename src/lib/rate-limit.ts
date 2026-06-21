import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

async function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  try {
    await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < now()`);
  } catch {
    // Non-critical
  }
}

export function createRateLimiter(windowMs = 60_000, maxRequests = 15) {
  return {
    async check(key: string): Promise<{ allowed: boolean; retryAfter: number }> {
      cleanupExpired();

      const now = new Date();
      const resetAt = new Date(now.getTime() + windowMs);

      try {
        const result = await db
          .insert(rateLimits)
          .values({ key, count: 1, resetAt })
          .onConflictDoUpdate({
            target: rateLimits.key,
            set: {
              count: sql`${rateLimits.count} + 1`,
              updatedAt: now,
            },
          })
          .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

        const entry = result[0];
        if (entry.count > maxRequests) {
          const retryAfter = Math.ceil((entry.resetAt.getTime() - now.getTime()) / 1000);
          return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
        }

        return { allowed: true, retryAfter: 0 };
      } catch {
        return { allowed: true, retryAfter: 0 };
      }
    },
  };
}

export const apiLimiter = createRateLimiter(60_000, 15);
export const emailAlertLimiter = createRateLimiter(60_000, 5);
export const cronLimiter = createRateLimiter(60_000, 3);

export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}
