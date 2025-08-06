// src/logger.ts

const LOG_KEY = 'obS3Uploader.logs';
const MAX_LOG_ENTRIES = 200;

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

function getLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLogs(logs: LogEntry[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES)));
  } catch {
    // ignore storage errors
  }
}

function log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
  const logs = getLogs();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  logs.push(entry);
  saveLogs(logs);
}

export const logger = {
  info: (message: string, data?: any) => log('info', message, data),
  warn: (message: string, data?: any) => log('warn', message, data),
  error: (message: string, data?: any) => log('error', message, data),
  get: getLogs,
  clear: () => saveLogs([]),
};