import { describe, it, expect } from "vitest";
import { LruCache } from "../../src/models/cache.model.js";

describe("LruCache", () => {
  it("should set and retrieve values", () => {
    const cache = new LruCache(3);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("non-existent")).toBeUndefined();
  });

  it("should evict least-recently-used item when capacity is exceeded", () => {
    const cache = new LruCache(2);
    cache.set("k1", "v1");
    cache.set("k2", "v2");

    // Access k1 to make it most recently used
    cache.get("k1");

    // Adding k3 should evict k2 (since k1 was accessed after k2)
    cache.set("k3", "v3");

    expect(cache.get("k1")).toBe("v1");
    expect(cache.get("k3")).toBe("v3");
    expect(cache.get("k2")).toBeUndefined();
  });

  it("should clear the cache properly", () => {
    const cache = new LruCache(10);
    cache.set("k1", 100);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("k1")).toBeUndefined();
  });
});
