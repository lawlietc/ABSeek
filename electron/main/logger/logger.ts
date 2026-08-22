import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string, detail?: unknown): void;
  warn(msg: string, detail?: unknown): void;
  error(msg: string, detail?: unknown): void;
}

const levelTag: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

/**
 * 简单按天滚动日志，分模块写入 data/logs/
 * 不引入 winston，避免过度工程
 *
 * @param consoleOut 是否同时输出到控制台。
 *   CLI 的 --json 模式传 false，避免日志行污染 JSON 输出（JSON 只从 stdout 解析）；
 *   GUI / 非 JSON 模式传 true 便于开发期排查。
 */
export function createLogger(module: string, logsDir: string, consoleOut = true): Logger {
  fs.mkdirSync(logsDir, { recursive: true });

  const write = (level: LogLevel, msg: string, detail?: unknown) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${module}] [${levelTag[level]}] ${msg}${
      detail ? ' ' + safeStringify(detail) : ''
    }\n`;
    const dateStr = ts.substring(0, 10);
    const file = path.join(logsDir, `${module}-${dateStr}.log`);
    try {
      fs.appendFileSync(file, line, 'utf8');
    } catch {
      // 日志写入失败不抛出
    }
    if (!consoleOut) return;
    // 同时 console 便于开发期排查
    if (level === 'error') console.error(line.trim());
    else if (level === 'warn') console.warn(line.trim());
    else console.log(line.trim());
  };

  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

function safeStringify(d: unknown): string {
  if (d instanceof Error) return d.stack || d.message;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}
