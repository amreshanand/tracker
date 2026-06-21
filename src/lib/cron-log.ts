import { db } from "@/db";
import { analyticsEvents } from "@/db/schema";

export interface CronLogEntry {
  startedAt: Date;
  processed: number;
  notified: number;
  failed: number;
  retried: number;
  durationMs?: number;
  error?: string;
}

export async function cronLog(job: string, data: Record<string, unknown>) {
  try {
    await db.insert(analyticsEvents).values({
      event: `cron:${job}`,
      metadata: JSON.stringify(data),
    });
  } catch {
    // Non-critical
  }
}
