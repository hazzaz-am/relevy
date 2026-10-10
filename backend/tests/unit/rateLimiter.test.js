import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TokenBucketLimiter,
  MemoryStore,
  createRateLimiterMiddleware,
} from "../../src/middlewares/rateLimiter.middleware.js";

describe("TokenBucketLimiter & MemoryStore", () => {
  let limiter;

  beforeEach(() => {
    limiter = new TokenBucketLimiter({
      limit: 10,
      windowMs: 1000, // 1 second window for easy testing
      maxBuckets: 3,
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("should initialize a new key with full tokens and allow consumption", () => {
    const result = limiter.consume("user1", 3);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7);
    expect(result.limit).toBe(10);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("should reject consumption when tokens are insufficient and calculate retryAfterSeconds", () => {
    limiter.consume("user1", 10); // Exhaust all 10 tokens

    const rejected = limiter.consume("user1", 2);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("should refill tokens proportionally over time", async () => {
    limiter.consume("user1", 10); // 0 tokens left

    // Advance time by 500ms (half the window => 5 tokens refilled)
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 500);

    const check = limiter.consume("user1", 4);
    expect(check.allowed).toBe(true);
    // 5 refilled - 4 consumed = 1 remaining
    expect(check.remaining).toBe(1);

    vi.restoreAllMocks();
  });

  it("should guard against negative clock adjustments (NTP skew)", () => {
    limiter.consume("user1", 5); // 5 tokens left

    // Simulate clock moving backward by 200ms
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now - 200);

    const result = limiter.consume("user1", 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);

    vi.restoreAllMocks();
  });

  it("should evict the least recently used bucket when maxBuckets is exceeded", () => {
    limiter.consume("key1", 1);
    limiter.consume("key2", 1);
    limiter.consume("key3", 1);

    // All 3 buckets exist
    expect(limiter.buckets.size).toBe(3);

    // Access key1 again, making key2 the least recently used
    limiter.consume("key1", 1);

    // Adding key4 should evict key2
    limiter.consume("key4", 1);

    expect(limiter.buckets.size).toBe(3);
    expect(limiter.buckets.has("key2")).toBe(false);
    expect(limiter.buckets.has("key1")).toBe(true);
    expect(limiter.buckets.has("key3")).toBe(true);
    expect(limiter.buckets.has("key4")).toBe(true);
  });

  it("should support the backward-compatible allow() method", () => {
    expect(limiter.allow("user1", 5)).toBe(true);
    expect(limiter.allow("user1", 10)).toBe(false);
  });

  it("should allow plugging in a custom asynchronous distributed store (e.g., RedisStore)", async () => {
    // Mock distributed store (simulating Redis / Lua script response)
    const mockDistributedStore = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 9,
        limit: 10,
        retryAfterSeconds: 0,
      }),
      destroy: vi.fn(),
    };

    const redisLimiter = new TokenBucketLimiter({
      limit: 10,
      store: mockDistributedStore,
    });

    const result = await redisLimiter.consume("tenant-1", 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(mockDistributedStore.consume).toHaveBeenCalledWith("tenant-1", 1, 10, 60000);

    redisLimiter.destroy();
    expect(mockDistributedStore.destroy).toHaveBeenCalled();
  });
});

describe("createRateLimiterMiddleware", () => {
  let limiter;
  let middleware;

  beforeEach(() => {
    limiter = new TokenBucketLimiter({
      limit: 5,
      windowMs: 1000,
    });
    middleware = createRateLimiterMiddleware({
      limiter,
      costFn: (req) => req.body?.cost || 1,
      message: "Rate limit reached",
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("should set rate limit headers and call next() when allowed", async () => {
    const req = {
      headers: { "x-relevy-install": "test-install" },
      ip: "127.0.0.1",
      body: { cost: 2 },
    };
    const headers = {};
    const res = {
      setHeader: (name, val) => {
        headers[name] = val;
      },
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    await middleware(req, res, next);

    expect(nextCalled).toBe(true);
    expect(headers["X-RateLimit-Limit"]).toBe(5);
    expect(headers["X-RateLimit-Remaining"]).toBe(3);
  });

  it("should return 429 with Retry-After header when rate limit is exceeded", async () => {
    const req = {
      headers: { "x-relevy-install": "test-install" },
      ip: "127.0.0.1",
      body: { cost: 6 }, // Exceeds limit of 5
    };
    const headers = {};
    let statusSent = null;
    let jsonSent = null;

    const res = {
      setHeader: (name, val) => {
        headers[name] = val;
      },
      status: (code) => {
        statusSent = code;
        return {
          json: (data) => {
            jsonSent = data;
          },
        };
      },
    };
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusSent).toBe(429);
    expect(headers["Retry-After"]).toBeGreaterThan(0);
    expect(jsonSent.error).toBe("Rate limit reached");
    expect(jsonSent.retryAfter).toBeGreaterThan(0);
  });
});
