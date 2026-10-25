// In-memory sliding-window rate limiter for API routes.
// Per-instance (per server process) — sufficient for the single-node
// deployment this app targets; swap for a shared store when scaling out.

const buckets = new Map<string, number[]>();

export interface RateLimitOptions {
  /** Logical bucket name (usually the route). */
  name: string;
  max: number;
  windowMs: number;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0]!.trim() : 'local';
}

/** Returns true when the request is allowed; false when over the limit. */
export function rateLimit(req: Request, { name, max, windowMs }: RateLimitOptions): boolean {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 10_000) {
    for (const [k, times] of buckets) {
      if (times.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}
