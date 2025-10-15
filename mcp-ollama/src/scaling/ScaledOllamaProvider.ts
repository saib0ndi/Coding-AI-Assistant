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
    // Inject load balancer into queue
    (this.requestQueue as any).executeWithLoadBalancer = async (payload: any) => {
      return await this.executeRequest(payload);
    };
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