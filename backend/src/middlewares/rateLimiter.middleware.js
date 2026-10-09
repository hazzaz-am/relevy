import { config } from "../config/env.js";

export class TokenBucketLimiter {
  constructor(limitPerMin = config.RATE_LIMIT_POSTS_PER_MIN) {
    this.limitPerMin = limitPerMin;
    this.buckets = new Map();

    // Clean up stale buckets every 60 seconds
    const cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - 10 * 60000;
      for (const [key, bucket] of this.buckets) {
        if (bucket.at < cutoff) {
          this.buckets.delete(key);
        }
      }
    }, 60000);

    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }

  allow(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.limitPerMin, at: now };
    }

    // Refill tokens proportionally
    b.tokens = Math.min(
      this.limitPerMin,
      b.tokens + ((now - b.at) / 60000) * this.limitPerMin
    );
    b.at = now;

    const ok = b.tokens >= cost;
    if (ok) {
      b.tokens -= cost;
    }

    this.buckets.set(key, b);
    return ok;
  }

  reset() {
    this.buckets.clear();
  }
}

export const defaultLimiter = new TokenBucketLimiter();

export function createRateLimiterMiddleware(limiter = defaultLimiter) {
  return (req, res, next) => {
    const installId = String(req.headers["x-relevy-install"] || "anon").slice(0, 64);
    const ip = req.ip || req.socket?.remoteAddress || "";
    const key = `${installId}|${ip}`;

    const cost = Array.isArray(req.body?.posts) ? req.body.posts.length : 1;

    if (!limiter.allow(key, cost)) {
      return res.status(429).json({
        error: "Too many posts scored this minute. Slow down a little.",
      });
    }

    next();
  };
}

export const rateLimiterMiddleware = createRateLimiterMiddleware(defaultLimiter);
