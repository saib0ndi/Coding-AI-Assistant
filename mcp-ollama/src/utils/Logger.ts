export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private level: LogLevel;
  private context: string;

  constructor(level: LogLevel = 'info', context: string = 'MCPServer') {
    this.level = level;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const sanitizedMessage = this.sanitizeLogInput(message);
    let metaString = '';
    if (meta) {
      try {
        metaString = ` ${JSON.stringify(meta)}`;
      } catch (error) {
        metaString = ' [Circular/Non-serializable]';
      }
    }
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${sanitizedMessage}${metaString}`;
  }

  private sanitizeLogInput(input: string): string {
    return input.replace(/[\r\n\t]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setContext(context: string): void {
    this.context = context;
  }

  createChildLogger(context: string): Logger {
    return new Logger(this.level, `${this.context}:${context}`);
  }
}