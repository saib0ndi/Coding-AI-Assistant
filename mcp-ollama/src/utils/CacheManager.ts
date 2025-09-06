import Database from 'better-sqlite3';
import { join, resolve, basename } from 'path';
import { mkdirSync } from 'fs';

export class CacheManager {
  private db: Database.Database;
  private maxSize: number = 1000;
  private currentSize: number = 0;
  private hits: number = 0;
  private misses: number = 0;
  
  // Prepared statements for performance
  private insertStmt!: Database.Statement;
  private selectStmt!: Database.Statement;
  private deleteStmt!: Database.Statement;
  private countStmt!: Database.Statement;
  private cleanExpiredStmt!: Database.Statement;
  private clearStmt!: Database.Statement;
  private deleteOldestStmt!: Database.Statement;

  constructor(maxSize?: number, dbPath?: string) {
    try {
      if (maxSize) {
        this.maxSize = maxSize;
      }
      
      const defaultPath = join(process.cwd(), 'cache');
      mkdirSync(defaultPath, { recursive: true });
      
      // Validate and sanitize dbPath to prevent path traversal
      let safePath: string;
      if (dbPath) {
        const resolvedPath = resolve(dbPath);
        const fileName = basename(resolvedPath);
        if (fileName.includes('..') || !fileName.match(/^[a-zA-Z0-9._-]+$/)) {
          throw new Error('Invalid database path');
        }
        safePath = join(defaultPath, fileName);
      } else {
        safePath = join(defaultPath, 'cache.db');
      }
      
      this.db = new Database(safePath);
      this.initializeDatabase();
      this.prepareStatements();
      this.loadCurrentSize();
    } catch (error) {
      throw new Error(`Failed to initialize cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expiry INTEGER NOT NULL
      )`;
    
    this.db.exec(createTableSQL);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_expiry ON cache(expiry)');
  }
  
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare('INSERT OR REPLACE INTO cache (key, data, expiry) VALUES (?, ?, ?)');
    this.selectStmt = this.db.prepare('SELECT data, expiry FROM cache WHERE key = ?');
    this.deleteStmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
    this.countStmt = this.db.prepare('SELECT COUNT(*) as count FROM cache');
    this.cleanExpiredStmt = this.db.prepare('DELETE FROM cache WHERE expiry < ?');
    this.clearStmt = this.db.prepare('DELETE FROM cache');
    this.deleteOldestStmt = this.db.prepare('DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY expiry LIMIT 1)');
  }
  
  private loadCurrentSize(): void {
    const result = this.countStmt.get() as { count: number };
    this.currentSize = result.count;
  }

  set(key: string, data: any, ttl: number = 300000): void {
    const sanitizedKey = this.sanitizeKey(key);
    
    this.cleanExpired();
    
    // Check if key exists without side effects
    const existing = this.selectStmt.get(sanitizedKey) as { expiry: number } | undefined;
    const wasReplacement = existing && Date.now() <= existing.expiry;
    
    if (!wasReplacement && this.currentSize >= this.maxSize) {
      this.deleteOldestStmt.run();
      this.currentSize--;
    }

    const expiry = Date.now() + ttl;
    
    try {
      this.insertStmt.run(sanitizedKey, JSON.stringify(data), expiry);
      if (!wasReplacement) {
        this.currentSize++;
      }
    } catch (error) {
      throw new Error(`Failed to set cache entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  get(key: string): any | null {
    const sanitizedKey = this.sanitizeKey(key);
    const entry = this.selectStmt.get(sanitizedKey) as { data: string; expiry: number } | undefined;
    
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiry) {
      this.deleteStmt.run(sanitizedKey);
      this.currentSize--;
      this.misses++;
      return null;
    }

    try {
      this.hits++;
      return JSON.parse(entry.data);
    } catch (error) {
      // Handle corrupted JSON data with proper logging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logError(`Failed to parse JSON for key '${sanitizedKey}': ${errorMessage}`);
      this.deleteStmt.run(sanitizedKey);
      this.currentSize--;
      this.misses++;
      return null;
    }
  }

  has(key: string): boolean {
    const sanitizedKey = this.sanitizeKey(key);
    const entry = this.selectStmt.get(sanitizedKey) as { expiry: number } | undefined;
    
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiry) {
      this.deleteStmt.run(sanitizedKey);
      this.currentSize--;
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const sanitizedKey = this.sanitizeKey(key);
    const result = this.deleteStmt.run(sanitizedKey);
    if (result.changes > 0) {
      this.currentSize--;
      return true;
    }
    return false;
  }

  clear(): void {
    this.clearStmt.run();
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    return this.currentSize;
  }

  private cleanExpired(): void {
    try {
      const now = Date.now();
      const result = this.cleanExpiredStmt.run(now);
      this.currentSize = Math.max(0, this.currentSize - result.changes);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logError(`Failed to clean expired entries: ${errorMessage}`);
    }
  }

  private sanitizeKey(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Cache key must be a non-empty string');
    }
    // Prevent SQL injection by strict validation
    const sanitized = key
      .replace(/[^a-zA-Z0-9_:-]/g, '_') // Allow only safe characters
      .substring(0, 250); // Limit length
    
    if (sanitized.length === 0) {
      throw new Error('Invalid cache key format after sanitization');
    }
    return sanitized;
  }

  private logError(message: string): void {
    // Use structured logging instead of console.error
    const timestamp = new Date().toISOString();
    const sanitizedMessage = message.replace(/[\r\n\t]/g, ' ');
    console.error(`[${timestamp}] [CacheManager] ${sanitizedMessage}`);
  }



  close(): void {
    this.db.close();
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;
    
    return {
      size: this.currentSize,
      maxSize: this.maxSize,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }
}