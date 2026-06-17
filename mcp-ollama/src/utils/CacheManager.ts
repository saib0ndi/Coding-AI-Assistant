export class CacheManager {
  private cache = new Map<string, { value: unknown; expires?: number }>();
  private static readonly MAX_SIZE = 500;

  get(key: string): unknown {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }

  set(key: string, value: unknown, ttl?: number): void {
    // Evict oldest entry when at capacity
    if (!this.cache.has(key) && this.cache.size >= CacheManager.MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    const entry: { value: unknown; expires?: number } = { value };
    if (ttl) {
      entry.expires = Date.now() + ttl;
    }
    this.cache.set(key, entry);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  size(): number {
    // Clean expired entries first
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && now > entry.expires) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }
}