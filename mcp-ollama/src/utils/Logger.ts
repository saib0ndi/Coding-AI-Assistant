import { currentTrace } from './Tracing.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Safe logger:
 *  - Strips control chars (CR/LF, ANSI) from message & meta (prevents log forging)
 *  - Redacts obvious secrets in meta (token, password, authorization, apiKey, cookie)
 *  - Handles circular refs & non-serializable values
 *  - Caps message/meta lengths to keep logs bounded
 *  - LOG_FORMAT=json emits structured JSON lines with traceId/spanId when active
 */
export class Logger {
  private level: LogLevel;
  private context: string;
  private static readonly jsonMode = process.env.LOG_FORMAT === 'json';

  private static readonly CONTROL = /[\r\n\x00-\x1F\x7F-\x9F]/g;
  private static readonly SECRET_KEY =
    /(pass(word)?|pwd|secret|token|authorization|api[-_]?key|session|cookie|set-cookie)/i;

  private static readonly MAX_MSG_LEN = 1000;
  private static readonly MAX_META_LEN = 4000;

  constructor(level: LogLevel = 'info', context: string = 'MCPServer') {
    this.level = level;
    this.context = this.scrubString(context);
  }

  private static readonly LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

  private shouldLog(level: LogLevel): boolean {
    return Logger.LEVELS[level] >= Logger.LEVELS[this.level];
  }

  private scrubString(input: unknown): string {
    const s = String(input != null ? input : '');
    return s.replace(Logger.CONTROL, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  private createReplacer(scrub: (input: unknown) => string, seen: WeakSet<object>) {
    return (key: string, value: unknown): unknown => {
      if (Logger.SECRET_KEY.test(key)) return '[REDACTED]';
      if (typeof value === 'string') return scrub(value);
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Error) {
        return { name: value.name, message: scrub(value.message), stack: scrub(value.stack) };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value as object)) return '[Circular]';
        seen.add(value as object);
      }
      return value;
    };
  }

  private stringifyMeta(meta: unknown): string {
    if (meta == null) return '';
    const seen = new WeakSet<object>();
    const scrub = this.scrubString.bind(this);
    let json: string;
    try {
      json = JSON.stringify(meta, this.createReplacer(scrub, seen));
    } catch {
      json = '"[Unserializable]"';
    }
    json = json.replace(Logger.CONTROL, ' ');
    if (json.length > Logger.MAX_META_LEN) json = json.slice(0, Logger.MAX_META_LEN) + '…';
    return ` ${json}`;
  }

  private formatText(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = this.getTimestamp();
    const ctx = this.scrubString(this.context);
    let msg = this.scrubString(message);
    if (msg.length > Logger.MAX_MSG_LEN) msg = msg.slice(0, Logger.MAX_MSG_LEN) + '…';
    const metaString = this.stringifyMeta(meta);
    const trace = currentTrace();
    const traceStr = trace ? ` [trace=${trace.traceId} span=${trace.spanId}]` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${ctx}]${traceStr} ${msg}${metaString}`;
  }

  private formatJson(level: LogLevel, message: string, meta?: unknown): string {
    const seen = new WeakSet<object>();
    const scrub = this.scrubString.bind(this);
    let msg = this.scrubString(message);
    if (msg.length > Logger.MAX_MSG_LEN) msg = msg.slice(0, Logger.MAX_MSG_LEN) + '…';
    const trace = currentTrace();

    const entry: Record<string, unknown> = {
      ts: this.getTimestamp(),
      level,
      ctx: this.scrubString(this.context),
      msg,
    };

    if (trace) {
      entry.traceId = trace.traceId;
      entry.spanId = trace.spanId;
      if (trace.parentSpanId) entry.parentSpanId = trace.parentSpanId;
      entry.op = trace.operation;
    }

    if (meta != null) {
      try {
        entry.meta = JSON.parse(JSON.stringify(meta, this.createReplacer(scrub, seen)));
      } catch {
        entry.meta = '[Unserializable]';
      }
    }

    try {
      return JSON.stringify(entry);
    } catch {
      return JSON.stringify({ ts: entry.ts, level, ctx: entry.ctx, msg });
    }
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    const line = Logger.jsonMode
      ? this.formatJson(level, message, meta)
      : this.formatText(level, message, meta);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  private timestampCache = { value: '', lastUpdate: 0 };
  private getTimestamp(): string {
    const now = Date.now();
    if (now - this.timestampCache.lastUpdate > 100) {
      this.timestampCache.value = new Date(now).toISOString();
      this.timestampCache.lastUpdate = now;
    }
    return this.timestampCache.value;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) this.emit('debug', message, meta);
  }
  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) this.emit('info', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) this.emit('warn', message, meta);
  }
  error(message: string, meta?: unknown): void {
    if (this.shouldLog('error')) this.emit('error', message, meta);
  }

  setLevel(level: LogLevel): void { this.level = level; }
  setContext(context: string): void { this.context = this.scrubString(context); }
  createChildLogger(context: string): Logger {
    return new Logger(this.level, `${this.context}:${context}`);
  }
}
