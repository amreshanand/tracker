export function createRateLimiter(windowMs = 60_000, maxRequests = 15) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  if (typeof setInterval !== "undefined") {
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of hits) {
        if (val.resetAt < now) hits.delete(key);
      }
    }, windowMs * 2).unref?.();
  }

  return {
    check(key: string): { allowed: boolean; retryAfter: number } {
      const now = Date.now();
      const entry = hits.get(key);

      if (!entry || entry.resetAt < now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfter: 0 };
      }

      entry.count++;
      if (entry.count > maxRequests) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
      }

      return { allowed: true, retryAfter: 0 };
    },
    _hits: hits,
  };
}

export const apiLimiter = createRateLimiter(60_000, 15);
