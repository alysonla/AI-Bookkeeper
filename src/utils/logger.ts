type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(minLevel: string = 'info'): Logger {
  const normalizedLevel = isLogLevel(minLevel) ? minLevel : 'info';

  function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (levelPriority[level] < levelPriority[normalizedLevel]) {
      return;
    }

    const logRecord = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    };

    const output = JSON.stringify(logRecord);

    if (level === 'error') {
      console.error(output);
      return;
    }

    if (level === 'warn') {
      console.warn(output);
      return;
    }

    console.log(output);
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

function isLogLevel(value: string): value is LogLevel {
  return value in levelPriority;
}
