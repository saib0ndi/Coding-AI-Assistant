import fetch from 'node-fetch';
import { loadAppConfig, parsePositiveInteger } from '../config/AppConfig.js';

interface OllamaInstance {
  id: string;
  host: string;
  isHealthy: boolean;
  activeRequests: number;
  maxRequests: number;
}

export class LoadBalancer {
  private instances: OllamaInstance[] = [];
  private healthCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.initializeInstances();
    this.startHealthChecks();
  }

  /** Stop the background health-check timer (allows clean process exit). */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private initializeInstances() {
    const appConfig = loadAppConfig();
    const hosts = (process.env.OLLAMA_HOSTS || appConfig.ollama.host)
      .split(',')
      .map(host => host.trim())
      .filter(Boolean);

    this.instances = hosts.map((host, i) => ({
      id: `ollama-${i}`,
      host: this.normalizeHost(host),
      isHealthy: true,
      activeRequests: 0,
      maxRequests: parsePositiveInteger(process.env.OLLAMA_INSTANCE_MAX_REQUESTS, 25)
    }));
  }

  private normalizeHost(host: string): string {
    if (/^https?:\/\//i.test(host)) {
      return host.replace(/\/+$/, '');
    }

    return `http://${host}`.replace(/\/+$/, '');
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
    this.healthCheckTimer = setInterval(async () => {
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

    // Don't let the background health checker keep the process alive (matters
    // for CLI/test runs); the long-running server stays up via its listeners.
    this.healthCheckTimer.unref?.();
  }
}
