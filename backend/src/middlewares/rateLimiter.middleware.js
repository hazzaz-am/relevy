import { config } from "../config/env.js";

const DEFAULT_WINDOW_MS = 60_000;
const STALE_CUTOFF_MS = 10 * 60_000;
const MAX_BUCKETS = 10_000;

/**
 * Storage Interface for Rate Limiting:
 * Any custom store (e.g. RedisStore) should implement:
 * - consume(key, cost, limit, windowMs): Promise<ConsumeResult> | ConsumeResult
 * - reset(): Promise<void> | void
 * - destroy(): Promise<void> | void
 *
 * @typedef {Object} ConsumeResult
 * @property {boolean} allowed
 * @property {number} remaining
 * @property {number} limit
 * @property {number} retryAfterSeconds
 */

/**
 * Default In-Memory Store with LRU eviction and stale key cleanup.
 */
export class MemoryStore {
  /**
   * @param {{ maxBuckets?: number, staleCutoffMs?: number, cleanupIntervalMs?: number }} [options]
   */
  constructor({
    maxBuckets = MAX_BUCKETS,
    staleCutoffMs = STALE_CUTOFF_MS,
    cleanupIntervalMs = DEFAULT_WINDOW_MS,
  } = {}) {
    this.maxBuckets = maxBuckets;
    this.staleCutoffMs = staleCutoffMs;
    this.buckets = new Map();

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Evaluates and consumes tokens in-memory.
   * @param {string} key
   * @param {number} cost
   * @param {number} limit
   * @param {number} windowMs
   * @returns {ConsumeResult}
   */
  consume(key, cost, limit, windowMs) {
    const safeCost = Math.max(1, Number.isFinite(cost) ? cost : 1);
    const now = Date.now();
    let b = this.buckets.get(key);

    if (!b) {
      // LRU eviction if maximum capacity reached
      if (this.buckets.size >= this.maxBuckets) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      b = { tokens: limit, at: now };
    } else {
      // Refresh key position in Map for LRU ordering
      this.buckets.delete(key);

      // Guard against system clock skew (NTP)
      const elapsed = Math.max(0, now - b.at);
      b.tokens = Math.min(
        limit,
        b.tokens + (elapsed / windowMs) * limit
      );
      b.at = now;
    }

    const allowed = b.tokens >= safeCost;
    if (allowed) {
      b.tokens -= safeCost;
    }

    this.buckets.set(key, b);

    const tokensNeeded = safeCost - b.tokens;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(1, Math.ceil((tokensNeeded / limit) * (windowMs / 1000)));

    return {
      allowed,
      remaining: Math.max(0, Math.floor(b.tokens)),
      limit,
      retryAfterSeconds,
    };
  }

  cleanup() {
    const cutoff = Date.now() - this.staleCutoffMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.at < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  reset() {
    this.buckets.clear();
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.reset();
  }
}

export class TokenBucketLimiter {
  /**
   * @param {number | {
   *   limit?: number,
   *   limitPerMin?: number,
   *   windowMs?: number,
   *   store?: MemoryStore | { consume: Function, reset?: Function, destroy?: Function },
   *   maxBuckets?: number
   * }} [options]
   */
  constructor(options = {}) {
    let limit = config.RATE_LIMIT_POSTS_PER_MIN;
    let windowMs = DEFAULT_WINDOW_MS;
    let store = null;
    let maxBuckets = MAX_BUCKETS;

    if (typeof options === "number") {
      limit = options;
    } else if (options && typeof options === "object") {
      if (options.limit !== undefined) limit = options.limit;
      if (options.limitPerMin !== undefined) limit = options.limitPerMin;
      if (options.windowMs !== undefined) windowMs = options.windowMs;
      if (options.store !== undefined) store = options.store;
      if (options.maxBuckets !== undefined) maxBuckets = options.maxBuckets;
    }

    this.limit = limit;
    this.limitPerMin = limit; // Backward compatibility
    this.windowMs = windowMs;
    this.store = store || new MemoryStore({ maxBuckets, cleanupIntervalMs: windowMs });

    // Backward-compatible access to buckets Map
    Object.defineProperty(this, "buckets", {
      get: () => (this.store.buckets ? this.store.buckets : new Map()),
    });
  }

  /**
   * Refills and evaluates token consumption for a key.
   * Supports both synchronous and asynchronous stores (e.g. Redis).
   * @param {string} key
   * @param {number} cost
   * @returns {Promise<ConsumeResult> | ConsumeResult}
   */
  consume(key, cost = 1) {
    return this.store.consume(key, cost, this.limit, this.windowMs);
  }

  /**
   * Backward-compatible convenience check.
   * @param {string} key
   * @param {number} cost
   * @returns {Promise<boolean> | boolean}
   */
  allow(key, cost = 1) {
    const res = this.consume(key, cost);
    if (res && typeof res.then === "function") {
      return res.then((r) => r.allowed);
    }
    return res.allowed;
  }

  cleanup() {
    if (typeof this.store.cleanup === "function") {
      this.store.cleanup();
    }
  }

  reset() {
    if (typeof this.store.reset === "function") {
      return this.store.reset();
    }
  }

  destroy() {
    if (typeof this.store.destroy === "function") {
      return this.store.destroy();
    }
  }
}

export const defaultLimiter = new TokenBucketLimiter();

/**
 * Reusable Rate Limiter Middleware Factory
 * @param {TokenBucketLimiter | {
 *   limiter?: TokenBucketLimiter,
 *   keyGenerator?: (req: import('express').Request) => string,
 *   costFn?: (req: import('express').Request) => number,
 *   message?: string
 * }} [options]
 */

export function createRateLimiterMiddleware(options = {}) {
  let limiter = defaultLimiter;
  let keyGenerator = (req) => {
    const installId = String(req.headers["x-relevy-install"] || "").trim().slice(0, 64);
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    return installId ? `${installId}|${ip}` : `ip|${ip}`;
  };
  let costFn = (req) => (Array.isArray(req.body?.posts) ? req.body.posts.length : 1);
  let message = "Too many posts scored this minute. Slow down a little.";

  if (options instanceof TokenBucketLimiter) {
    limiter = options;
  } else if (options && typeof options === "object") {
    if (options.limiter) limiter = options.limiter;
    if (typeof options.keyGenerator === "function") keyGenerator = options.keyGenerator;
    if (typeof options.costFn === "function") costFn = options.costFn;
    if (options.message) message = options.message;
  }

  return async (req, res, next) => {
    if (res.headersSent) {
      return next();
    }

    try {
      const key = keyGenerator(req);
      const cost = costFn(req);

      const { allowed, remaining, limit, retryAfterSeconds } = await limiter.consume(key, cost);

      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", remaining);

      if (!allowed) {
        res.setHeader("Retry-After", retryAfterSeconds);
        return res.status(429).json({
          error: message,
          retryAfter: retryAfterSeconds,
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const rateLimiterMiddleware = createRateLimiterMiddleware(defaultLimiter);
