import { env } from "../../config/env";

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const store = new Map<string, RateLimitEntry>();

// Periodically prune expired entries to avoid memory leaks
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now - entry.windowStart > env.AUTH_RATE_LIMIT_WINDOW_MS * 2) {
        store.delete(key);
      }
    }
  },
  Math.max(env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
).unref();

/**
 * Returns true if the request should be rate-limited (blocked).
 */
export function isRateLimited(ip: string, action: string): boolean {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > env.AUTH_RATE_LIMIT_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  if (entry.count > env.AUTH_RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}
