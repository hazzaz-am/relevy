/**
 * In-memory Least-Recently-Used (LRU) Cache backed by ES Map.
 * JavaScript Map maintains insertion order.
 */
export class LruCache {
  constructor(maxSize = 50000) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    // Refresh position to mark as recently used
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      // Evict oldest entry (first item in Map)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
  }

  has(key) {
    return this.map.has(key);
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
