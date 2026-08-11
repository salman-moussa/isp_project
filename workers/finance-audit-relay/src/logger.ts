export type RelayLogLevel = 'info' | 'warn' | 'error';

export interface RelayLogger {
  write(level: RelayLogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const jsonLogger: RelayLogger = {
  write(level, event, fields = {}) {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'finance-audit-relay',
      event,
      ...fields,
    });
    if (level === 'error') process.stderr.write(`${record}\n`);
    else process.stdout.write(`${record}\n`);
  },
};
