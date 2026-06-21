import { db } from "@/db";
import { cronLock } from "@/db/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import crypto from "crypto";

const INSTANCE_ID = crypto.randomUUID();
const LOCK_DURATION_MS = 10 * 60 * 1000;

export interface CronLockResult {
  acquired: boolean;
  instanceId: string;
}

export async function acquireCronLock(jobName: string, ttlMs = LOCK_DURATION_MS): Promise<CronLockResult> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  try {
    // Try to claim the lock:
    // If no row exists → insert succeeds
    // If row exists & lock is expired → update succeeds
    // If row exists & lock is held → update fails (0 rows affected)

    // Step 1: Try to insert (fails if row already exists)
    const insertResult = await db
      .insert(cronLock)
      .values({
        jobName,
        lockedAt: now,
        lockedUntil,
        instanceId: INSTANCE_ID,
      })
      .onConflictDoNothing()
      .returning({ instanceId: cronLock.instanceId });

    if (insertResult.length > 0) {
      return { acquired: true, instanceId: INSTANCE_ID };
    }

    // Step 2: Row exists — try to update if expired
    const updateResult = await db
      .update(cronLock)
      .set({
        lockedAt: now,
        lockedUntil,
        instanceId: INSTANCE_ID,
      })
      .where(
        and(
          eq(cronLock.jobName, jobName),
          lt(cronLock.lockedUntil, now)
        )
      )
      .returning({ instanceId: cronLock.instanceId });

    if (updateResult.length > 0) {
      return { acquired: true, instanceId: INSTANCE_ID };
    }

    // Step 3: Lock is held by another instance
    const [current] = await db
      .select({ instanceId: cronLock.instanceId })
      .from(cronLock)
      .where(eq(cronLock.jobName, jobName))
      .limit(1);

    return {
      acquired: current?.instanceId === INSTANCE_ID,
      instanceId: current?.instanceId ?? "",
    };
  } catch {
    return { acquired: false, instanceId: INSTANCE_ID };
  }
}

export async function releaseCronLock(jobName: string): Promise<void> {
  try {
    await db
      .update(cronLock)
      .set({ lockedUntil: new Date(0) })
      .where(
        and(
          eq(cronLock.jobName, jobName),
          eq(cronLock.instanceId, INSTANCE_ID)
        )
      );
  } catch {
    // Non-critical
  }
}
