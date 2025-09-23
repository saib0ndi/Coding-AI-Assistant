export class CacheManager {
  private cache = new Map<string, { value: any; expires: number }>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private lastCleanup = 0;
  private readonly cleanupInterval = 300000; // 5 minutes

  constructor(maxSize: number = Number(process.env.CACHE_MAX_SIZE || 10000), dbPath?: string) {
    this.maxSize = maxSize;
    this.ttl = 3600000; // 1 hour default
  }

  private cleanupExpired(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;
    
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
      }
    }
    this.lastCleanup = now;
  }

  get(key: string): any {
    this.cleanupExpired();
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  set(key: string, value: any, customTtl?: number): void {
    this.cleanupExpired();
    const ttl = customTtl || this.ttl;
    const expires = Date.now() + ttl;
    
    this.cache.set(key, { value, expires });
    
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  size(): number {
    this.cleanupExpired();
    let validCount = 0;
    const now = Date.now();
    for (const item of this.cache.values()) {
      if (now <= item.expires) validCount++;
    }
    return validCount;
  }
}