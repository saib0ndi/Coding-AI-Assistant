import fetch from 'node-fetch';

interface OllamaInstance {
  id: string;
  host: string;
  isHealthy: boolean;
  activeRequests: number;
  maxRequests: number;
}

export class LoadBalancer {
  private instances: OllamaInstance[] = [];

  constructor() {
    this.initializeInstances();
    this.startHealthChecks();
  }

  private initializeInstances() {
    const hosts = [
      '10.10.110.25', '10.10.110.26', '10.10.110.27', 
      '10.10.110.28', '10.10.110.29'
    ];

    this.instances = hosts.map((host, i) => ({
      id: `ollama-${i}`,
      host: `http://${host}:11434`,
      isHealthy: true,
      activeRequests: 0,
      maxRequests: 25
    }));
  }

  getNextInstance(): OllamaInstance | null {
    const available = this.instances.filter(i => 
      i.isHealthy && i.activeRequests < i.maxRequests
    );
    
    if (available.length === 0) return null;
    
    return available.sort((a, b) => a.activeRequests - b.activeRequests)[0];
  }

  async executeRequest(instance: OllamaInstance, requestFn: () => Promise<any>) {
    instance.activeRequests++;
    try {
      return await requestFn();
    } finally {
      instance.activeRequests--;
    }
  }

  private async startHealthChecks() {
    setInterval(async () => {
      for (const instance of this.instances) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(`${instance.host}/api/tags`, { signal: controller.signal });
          clearTimeout(timeoutId);
          instance.isHealthy = response.ok;
        } catch {
          instance.isHealthy = false;
        }
      }
    }, 30000);
  }
}