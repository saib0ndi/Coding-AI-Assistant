import { LoadBalancer } from './LoadBalancer.js';
import { RequestQueue } from './RequestQueue.js';
import { CacheLayer } from './CacheLayer.js';
import fetch from 'node-fetch';

export class ScaledOllamaProvider {
  private loadBalancer: LoadBalancer;
  private requestQueue: RequestQueue;
  private cache: CacheLayer;

  constructor() {
    this.loadBalancer = new LoadBalancer();
    this.requestQueue = new RequestQueue();
    this.cache = new CacheLayer();
    this.setupQueueProcessor();
  }

  private setupQueueProcessor() {
    // Inject load balancer into queue. Two payload shapes are supported:
    //  - { run: () => Promise<T> }  → arbitrary guarded operation (dispatch)
    //  - legacy generate payload    → raw /api/generate via the load balancer
    (this.requestQueue as any).executeWithLoadBalancer = async (payload: any) => {
      if (payload && typeof payload.run === 'function') {
        return await this.runOnInstance(payload.run);
      }
      return await this.executeRequest(payload);
    };
  }

  /**
   * Run an arbitrary request fn through the scaling layer: the request queue
   * provides a global concurrency gate, and the load balancer tracks
   * per-instance active counts. If no healthy instance is available we still
   * run the fn directly (no-throw fallback) so this can never block real
   * traffic — the fn itself owns the actual host/timeout/retry logic.
   *
   * Note: no response caching is applied here. Caching mutating agent calls
   * would risk returning stale results across an iterative fix→verify loop;
   * the CacheLayer is reserved for explicitly idempotent reads.
   */
  async dispatch<T>(fn: () => Promise<T>): Promise<T> {
    return this.requestQueue.enqueue({ run: fn }) as Promise<T>;
  }

  private async runOnInstance<T>(fn: () => Promise<T>): Promise<T> {
    const instance = this.loadBalancer.getNextInstance();
    if (!instance) {
      // No instance metadata available (or all busy/unhealthy) — run directly.
      return await fn();
    }
    return await this.loadBalancer.executeRequest(instance, fn);
  }

  async generateText(prompt: string, model: string, options?: any): Promise<string> {
    // Check cache first
    const cacheKey = this.cache.generateKey(prompt, model, options);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Queue the request
    const result = await this.requestQueue.enqueue({
      prompt,
      model,
      options,
      type: 'generate'
    });

    // Cache the result
    this.cache.set(cacheKey, result);
    return result;
  }

  private async executeRequest(payload: any): Promise<string> {
    const instance = this.loadBalancer.getNextInstance();
    if (!instance) {
      throw new Error('No available Ollama instances');
    }

    return await this.loadBalancer.executeRequest(instance, async () => {
      const response = await fetch(`${instance.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model,
          prompt: payload.prompt,
          stream: false,
          options: {
            num_predict: 200,
            temperature: 0.3,
            ...payload.options
          }
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;
      return data.response || '';
    });
  }

  getSystemStats() {
    return {
      queue: this.requestQueue.getQueueStats(),
      cache: this.cache.getStats(),
      instances: this.loadBalancer['instances'].map(i => ({
        id: i.id,
        healthy: i.isHealthy,
        active: i.activeRequests,
        max: i.maxRequests
      }))
    };
  }
}

// Shared singleton so the agent request path (AgentOllamaRegistry), the HTTP
// stats endpoint, and startup all observe the same queue/cache/instances.
let scaledInstance: ScaledOllamaProvider | null = null;
export function getScaledProvider(): ScaledOllamaProvider {
  if (!scaledInstance) scaledInstance = new ScaledOllamaProvider();
  return scaledInstance;
}