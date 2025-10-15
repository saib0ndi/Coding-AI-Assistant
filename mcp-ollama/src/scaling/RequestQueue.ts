interface QueuedRequest {
  id: string;
  payload: any;
  priority: number;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class RequestQueue {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private concurrency = 100; // Process 100 requests concurrently
  private activeRequests = 0;

  async enqueue(payload: any, priority = 1): Promise<any> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: `req-${Date.now()}-${Math.random()}`,
        payload,
        priority,
        timestamp: Date.now(),
        resolve,
        reject
      };

      this.queue.push(request);
      this.queue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
      
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.activeRequests >= this.concurrency) return;
    
    this.processing = true;
    
    while (this.queue.length > 0 && this.activeRequests < this.concurrency) {
      const request = this.queue.shift();
      if (request) {
        this.activeRequests++;
        this.processRequest(request);
      }
    }
    
    this.processing = false;
  }

  private async processRequest(request: QueuedRequest) {
    try {
      // Process request through load balancer
      const result = await this.executeWithLoadBalancer(request.payload);
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    } finally {
      this.activeRequests--;
      this.processQueue();
    }
  }

  private async executeWithLoadBalancer(payload: any): Promise<any> {
    // Implementation will be injected
    throw new Error('Load balancer not configured');
  }

  getQueueStats() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      concurrency: this.concurrency
    };
  }
}