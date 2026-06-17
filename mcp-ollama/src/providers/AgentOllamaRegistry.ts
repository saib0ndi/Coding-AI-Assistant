import { Logger } from '../utils/Logger.js';
import { OllamaConfig } from '../types/index.js';
import { OllamaProvider } from './OllamaProvider.js';
import { loadAppConfig, parsePositiveInteger } from '../config/AppConfig.js';
import { CircuitBreaker, CircuitState } from '../utils/CircuitBreaker.js';
import { getScaledProvider } from '../scaling/ScaledOllamaProvider.js';

/** Agent roles that may use a dedicated Ollama endpoint/model. */
export type AgentOllamaRole = 'orchestrator' | 'code' | 'test' | 'project' | 'autonomous';

const ROLES: AgentOllamaRole[] = ['orchestrator', 'code', 'test', 'project', 'autonomous'];

/**
 * One OllamaProvider (host + model + timeout) per agent role.
 * Each role has an independent CircuitBreaker — if one Ollama endpoint is
 * unhealthy, only that role is blocked; others continue serving.
 *
 * Env overrides: OLLAMA_<ROLE>_HOST, OLLAMA_<ROLE>_MODEL, OLLAMA_<ROLE>_TIMEOUT_MS
 * Circuit env overrides: CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_COOLDOWN_MS
 */
export class AgentOllamaRegistry {
  private readonly logger = new Logger();
  private readonly providers = new Map<AgentOllamaRole, OllamaProvider>();
  private readonly breakers = new Map<AgentOllamaRole, CircuitBreaker>();

  constructor(baseConfig: OllamaConfig) {
    const failureThreshold = parsePositiveInteger(process.env.CIRCUIT_FAILURE_THRESHOLD, 5);
    const cooldownMs = parsePositiveInteger(process.env.CIRCUIT_COOLDOWN_MS, 30_000);
    const successThreshold = parsePositiveInteger(process.env.CIRCUIT_SUCCESS_THRESHOLD, 2);

    const scaled = getScaledProvider();
    const parts: string[] = [];
    for (const role of ROLES) {
      const config = this.resolveConfig(role, baseConfig);
      const provider = new OllamaProvider(config, role);
      const breaker = new CircuitBreaker({ label: role, failureThreshold, cooldownMs, successThreshold });

      // Every low-level request for this role now flows through:
      //   circuit breaker (fail fast when the endpoint is down)
      //     → scaled dispatch (shared concurrency queue + load-balancer accounting)
      //       → the provider's own request logic (cloud/streaming/auth/retry/timeout)
      provider.setRequestGuard(<T>(fn: () => Promise<T>) =>
        breaker.execute(() => scaled.dispatch(fn))
      );

      this.providers.set(role, provider);
      this.breakers.set(role, breaker);
      parts.push(`${role}=${config.model}@${config.host.replace(/^https?:\/\//, '')}`);
    }
    this.logger.info(`Agent Ollama routing: ${parts.join(' | ')}`);
  }

  get(role: AgentOllamaRole): OllamaProvider {
    const provider = this.providers.get(role);
    if (!provider) {
      throw new Error(`No Ollama provider registered for role: ${role}`);
    }
    return provider;
  }

  /**
   * Run `fn` through the circuit breaker for `role`.
   * Throws immediately if the circuit is open, preventing calls to a known-down endpoint.
   */
  async executeWithBreaker<T>(role: AgentOllamaRole, fn: () => Promise<T>): Promise<T> {
    const breaker = this.breakers.get(role);
    if (!breaker) throw new Error(`No circuit breaker for role: ${role}`);
    return breaker.execute(fn);
  }

  getCircuitState(role: AgentOllamaRole): CircuitState {
    return this.breakers.get(role)?.getState() ?? 'closed';
  }

  getCircuitStats(): Record<AgentOllamaRole, ReturnType<CircuitBreaker['getStats']>> {
    const out: Record<string, ReturnType<CircuitBreaker['getStats']>> = {};
    for (const role of ROLES) {
      out[role] = this.breakers.get(role)!.getStats();
    }
    return out as Record<AgentOllamaRole, ReturnType<CircuitBreaker['getStats']>>;
  }

  resetBreaker(role: AgentOllamaRole): void {
    this.breakers.get(role)?.reset();
  }

  /** Default provider for MCP tools and workflow planning. */
  getOrchestrator(): OllamaProvider {
    return this.get('orchestrator');
  }

  getSummary(): Record<AgentOllamaRole, { host: string; model: string; circuit: CircuitState }> {
    const out = new Map<AgentOllamaRole, { host: string; model: string; circuit: CircuitState }>();
    for (const role of ROLES) {
      const p = this.get(role);
      out.set(role, { host: p.getHost(), model: p.getDefaultModel(), circuit: this.getCircuitState(role) });
    }
    return Object.fromEntries(out.entries()) as Record<AgentOllamaRole, { host: string; model: string; circuit: CircuitState }>;
  }

  private resolveConfig(role: AgentOllamaRole, base: OllamaConfig): OllamaConfig {
    let hostOverride: string | undefined;
    let modelOverride: string | undefined;
    let timeoutOverride: string | undefined;

    switch (role) {
      case 'orchestrator':
        hostOverride = process.env.OLLAMA_ORCHESTRATOR_HOST;
        modelOverride = process.env.OLLAMA_ORCHESTRATOR_MODEL;
        timeoutOverride = process.env.OLLAMA_ORCHESTRATOR_TIMEOUT_MS;
        break;
      case 'code':
        hostOverride = process.env.OLLAMA_CODE_HOST;
        modelOverride = process.env.OLLAMA_CODE_MODEL;
        timeoutOverride = process.env.OLLAMA_CODE_TIMEOUT_MS;
        break;
      case 'test':
        hostOverride = process.env.OLLAMA_TEST_HOST;
        modelOverride = process.env.OLLAMA_TEST_MODEL;
        timeoutOverride = process.env.OLLAMA_TEST_TIMEOUT_MS;
        break;
      case 'project':
        hostOverride = process.env.OLLAMA_PROJECT_HOST;
        modelOverride = process.env.OLLAMA_PROJECT_MODEL;
        timeoutOverride = process.env.OLLAMA_PROJECT_TIMEOUT_MS;
        break;
      case 'autonomous':
        hostOverride = process.env.OLLAMA_AUTONOMOUS_HOST;
        modelOverride = process.env.OLLAMA_AUTONOMOUS_MODEL;
        timeoutOverride = process.env.OLLAMA_AUTONOMOUS_TIMEOUT_MS;
        break;
    }

    const host = hostOverride?.trim() || base.host;
    const model = modelOverride?.trim() || this.roleDefaultModel(role) || base.model;
    const timeout = parsePositiveInteger(timeoutOverride, base.timeout);

    return { host, model, timeout };
  }

  private roleDefaultModel(role: AgentOllamaRole): string | undefined {
    const appConfig = loadAppConfig();
    switch (role) {
      case 'code':
        return appConfig.ollama.codeModel;
      case 'test':
        return appConfig.ollama.testModel;
      case 'project':
        return appConfig.ollama.projectModel;
      case 'autonomous':
        return appConfig.ollama.autonomousModel || appConfig.ollama.fastModel;
      case 'orchestrator':
        return appConfig.ollama.model;
      default:
        return undefined;
    }
  }
}
