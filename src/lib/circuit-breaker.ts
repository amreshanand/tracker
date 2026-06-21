import { db } from "@/db";
import { circuitBreaker } from "@/db/schema";
import { eq } from "drizzle-orm";

const THRESHOLD = 5;
const RESET_TIMEOUT_MS = 5 * 60 * 1000;
const HALF_OPEN_MAX_ATTEMPTS = 2;

export type CircuitState = "closed" | "open" | "half-open";

export async function getCircuitState(provider: string): Promise<CircuitState> {
  try {
    const [entry] = await db
      .select()
      .from(circuitBreaker)
      .where(eq(circuitBreaker.provider, provider))
      .limit(1);

    if (!entry) return "closed";
    if (entry.state === "open") {
      if (entry.openedAt && Date.now() - new Date(entry.openedAt).getTime() > RESET_TIMEOUT_MS) {
        await db
          .update(circuitBreaker)
          .set({ state: "half-open", halfOpenAttempts: 0 })
          .where(eq(circuitBreaker.provider, provider));
        return "half-open";
      }
      return "open";
    }
    if (entry.state === "half-open") {
      if (entry.halfOpenAttempts >= HALF_OPEN_MAX_ATTEMPTS) {
        return "open";
      }
    }
    return entry.state as CircuitState;
  } catch {
    return "closed";
  }
}

export async function recordSuccess(provider: string): Promise<void> {
  try {
    await db
      .insert(circuitBreaker)
      .values({
        provider,
        state: "closed",
        failureCount: 0,
        lastSuccessAt: new Date(),
      })
      .onConflictDoUpdate({
        target: circuitBreaker.provider,
        set: {
          state: "closed",
          failureCount: 0,
          lastSuccessAt: new Date(),
          openedAt: null,
          halfOpenAttempts: 0,
        },
      });
  } catch {
    // Non-critical
  }
}

export async function recordFailure(provider: string): Promise<void> {
  try {
    const [entry] = await db
      .select()
      .from(circuitBreaker)
      .where(eq(circuitBreaker.provider, provider))
      .limit(1);

    if (!entry) {
      await db.insert(circuitBreaker).values({
        provider,
        state: "closed",
        failureCount: 1,
        lastFailureAt: new Date(),
      });
      return;
    }

    const newCount = entry.failureCount + 1;
    const isHalfOpen = entry.state === "half-open";
    const shouldOpen = newCount >= THRESHOLD;

    await db
      .update(circuitBreaker)
      .set({
        failureCount: newCount,
        lastFailureAt: new Date(),
        state: shouldOpen ? "open" : isHalfOpen ? "closed" : entry.state,
        openedAt: shouldOpen ? new Date() : entry.openedAt,
        halfOpenAttempts: isHalfOpen ? entry.halfOpenAttempts + 1 : 0,
      })
      .where(eq(circuitBreaker.provider, provider));
  } catch {
    // Non-critical
  }
}

export async function isCircuitAvailable(provider: string): Promise<boolean> {
  const state = await getCircuitState(provider);
  if (state === "open") return false;
  if (state === "half-open") {
    const [entry] = await db
      .select()
      .from(circuitBreaker)
      .where(eq(circuitBreaker.provider, provider))
      .limit(1);
    if (entry && entry.halfOpenAttempts >= HALF_OPEN_MAX_ATTEMPTS) return false;
  }
  return true;
}
