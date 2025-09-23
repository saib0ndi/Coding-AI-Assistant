export class DynamicConfig {
  private static cache = new Map<string, any>();
  private static userPreferences = new Map<string, any>();
  
  static getContextLines(documentSize: number, memoryUsage: number): number {
    const key = `context-${documentSize}-${Math.floor(memoryUsage / 100)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    
    const baseLines = Number(process.env.BASE_CONTEXT_LINES || 10);
    const minFactor = Number(process.env.MIN_MEMORY_FACTOR || 0.5);
    const maxFactor = Number(process.env.MAX_MEMORY_FACTOR || 2);
    const memoryThreshold = Number(process.env.MEMORY_THRESHOLD || 1024);
    const divisor = Number(process.env.MEMORY_DIVISOR || 512);
    const memoryFactor = Math.max(minFactor, Math.min(maxFactor, (memoryThreshold - memoryUsage) / divisor));
    const sizeThreshold = Number(process.env.DOCUMENT_SIZE_THRESHOLD || 1000);
    const largeFactor = Number(process.env.LARGE_DOC_FACTOR || 0.8);
    const smallFactor = Number(process.env.SMALL_DOC_FACTOR || 1.2);
    const sizeFactor = documentSize > sizeThreshold ? largeFactor : smallFactor;
    
    const result = Math.floor(baseLines * memoryFactor * sizeFactor);
    this.cache.set(key, result);
    return result;
  }
  
  static getContentLimit(availableMemory: number): number {
    const key = `content-${Math.floor(availableMemory / 1024)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    
    const baseLimit = Number(process.env.BASE_CONTENT_LIMIT || 1000);
    const bytesPerGB = Number(process.env.BYTES_PER_GB || 1073741824);
    const maxMultiplier = Number(process.env.MAX_MEMORY_MULTIPLIER || 4);
    const memoryGB = availableMemory / bytesPerGB;
    const result = Math.floor(baseLimit * Math.min(memoryGB, maxMultiplier));
    
    this.cache.set(key, result);
    return result;
  }
  
  static getMaxSuggestions(userAcceptanceRate: number): number {
    const base = Number(process.env.BASE_SUGGESTIONS || 3);
    const highThreshold = Number(process.env.HIGH_ACCEPTANCE_THRESHOLD || 0.7);
    const lowThreshold = Number(process.env.LOW_ACCEPTANCE_THRESHOLD || 0.4);
    const bonus = Number(process.env.SUGGESTION_BONUS || 2);
    return userAcceptanceRate > highThreshold ? base + bonus : 
           userAcceptanceRate > lowThreshold ? base : base - 1;
  }
  
  static getTimeout(networkLatency: number, serverLoad: number): number {
    const base = Number(process.env.BASE_TIMEOUT_MS || 30000);
    const latencyDivisor = Number(process.env.LATENCY_DIVISOR || 100);
    const loadDivisor = Number(process.env.LOAD_DIVISOR || 50);
    const maxTimeout = Number(process.env.MAX_TIMEOUT_MS || 300000);
    const latencyMultiplier = Math.max(1, networkLatency / latencyDivisor);
    const loadMultiplier = Math.max(1, serverLoad / loadDivisor);
    return Math.min(base * latencyMultiplier * loadMultiplier, maxTimeout);
  }
}