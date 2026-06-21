import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyResult {
  isNew: boolean;
  existingResponse?: { status: number; body: unknown } | null;
}

export async function checkIdempotency(key: string): Promise<IdempotencyResult> {
  try {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1);

    if (existing) {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age < IDEMPOTENCY_TTL_MS) {
        return {
          isNew: false,
          existingResponse: {
            status: existing.responseStatus,
            body: existing.responseBody,
          },
        };
      }
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    }

    return { isNew: true };
  } catch {
    return { isNew: true };
  }
}

export async function saveIdempotencyResponse(
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  try {
    await db
      .insert(idempotencyKeys)
      .values({
        key,
        responseStatus: status,
        responseBody: body as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: {
          responseStatus: status,
          responseBody: body as Record<string, unknown>,
        },
      });
  } catch {
    // Non-critical
  }
}
