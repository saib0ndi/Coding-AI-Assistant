import { createHash } from 'crypto';

interface CacheEntry {
  data: any;
  timestamp: number;
  hits: number;
  ttl: number;
}

export class CacheLayer {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 10000;
  private defaultTTL = 1800000; // 30 minutes

  generateKey(prompt: string, model: string, options?: any): string {
    const content = JSON.stringify({ prompt, model, options });
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    entry.hits++;
    return entry.data;
  }

  set(key: string, data: any, ttl = this.defaultTTL): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
      ttl
    });
  }

  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();
    let lowestHits = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.hits < lowestHits || 
          (entry.hits === lowestHits && entry.timestamp < oldestTime)) {
        oldestKey = key;
        oldestTime = entry.timestamp;
        lowestHits = entry.hits;
      }
    }

    if (oldestKey) this.cache.delete(oldestKey);
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.calculateHitRate()
    };
  }

  private calculateHitRate(): number {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    return entries.length > 0 ? totalHits / entries.length : 0;
  }
}