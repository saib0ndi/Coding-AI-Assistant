import { parsePositiveInteger } from '../config/AppConfig.js';

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class DynamicConfig {
  private static cache = new Map<string, number>();
  
  static getContextLines(documentSize: number, memoryUsage: number): number {
    const key = `context-${documentSize}-${Math.floor(memoryUsage / 100)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    
    const baseLines = parsePositiveInteger(process.env.BASE_CONTEXT_LINES, 10);
    const minFactor = parsePositiveNumber(process.env.MIN_MEMORY_FACTOR, 0.5);
    const maxFactor = parsePositiveNumber(process.env.MAX_MEMORY_FACTOR, 2);
    const memoryThreshold = parsePositiveNumber(process.env.MEMORY_THRESHOLD, 1024);
    const divisor = parsePositiveNumber(process.env.MEMORY_DIVISOR, 512);
    const memoryFactor = Math.max(minFactor, Math.min(maxFactor, (memoryThreshold - memoryUsage) / divisor));
    const sizeThreshold = parsePositiveInteger(process.env.DOCUMENT_SIZE_THRESHOLD, 1000);
    const largeFactor = parsePositiveNumber(process.env.LARGE_DOC_FACTOR, 0.8);
    const smallFactor = parsePositiveNumber(process.env.SMALL_DOC_FACTOR, 1.2);
    const sizeFactor = documentSize > sizeThreshold ? largeFactor : smallFactor;
    
    const result = Math.floor(baseLines * memoryFactor * sizeFactor);
    this.cache.set(key, result);
    return result;
  }
  
  static getContentLimit(availableMemory: number): number {
    const key = `content-${Math.floor(availableMemory / 1024)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    
    const baseLimit = parsePositiveInteger(process.env.BASE_CONTENT_LIMIT, 1000);
    const bytesPerGB = parsePositiveInteger(process.env.BYTES_PER_GB, 1073741824);
    const maxMultiplier = parsePositiveNumber(process.env.MAX_MEMORY_MULTIPLIER, 4);
    const memoryGB = availableMemory / bytesPerGB;
    const result = Math.floor(baseLimit * Math.min(memoryGB, maxMultiplier));
    
    this.cache.set(key, result);
    return result;
  }
  
  static getMaxSuggestions(userAcceptanceRate: number): number {
    const base = parsePositiveInteger(process.env.BASE_SUGGESTIONS, 3);
    const highThreshold = parsePositiveNumber(process.env.HIGH_ACCEPTANCE_THRESHOLD, 0.7);
    const lowThreshold = parsePositiveNumber(process.env.LOW_ACCEPTANCE_THRESHOLD, 0.4);
    const bonus = parsePositiveInteger(process.env.SUGGESTION_BONUS, 2);
    return userAcceptanceRate > highThreshold ? base + bonus : 
           userAcceptanceRate > lowThreshold ? base : base - 1;
  }
  
  static getTimeout(networkLatency: number, serverLoad: number): number {
    const base = parsePositiveInteger(process.env.BASE_TIMEOUT_MS, 30000);
    const latencyDivisor = parsePositiveNumber(process.env.LATENCY_DIVISOR, 100);
    const loadDivisor = parsePositiveNumber(process.env.LOAD_DIVISOR, 50);
    const maxTimeout = parsePositiveInteger(process.env.MAX_TIMEOUT_MS, 300000);
    const latencyMultiplier = Math.max(1, networkLatency / latencyDivisor);
    const loadMultiplier = Math.max(1, serverLoad / loadDivisor);
    return Math.min(base * latencyMultiplier * loadMultiplier, maxTimeout);
  }
}
