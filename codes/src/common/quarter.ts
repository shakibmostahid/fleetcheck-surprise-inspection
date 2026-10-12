import { Quarter } from './interfaces/quarter.interface';

/** A calendar quarter in the format YYYY-Qn, e.g. "2026-Q4". */
export const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/;

export function parseQuarter(value: string): Quarter {
  if (!QUARTER_PATTERN.test(value)) {
    throw new Error(`Invalid quarter "${value}". Expected format YYYY-Qn, e.g. 2026-Q4`);
  }
  const [year, quarter] = value.split('-Q').map(Number);
  return { year, quarter: quarter as Quarter['quarter'] };
}

export function formatQuarter({ year, quarter }: Quarter): string {
  return `${year}-Q${quarter}`;
}

/** The quarter that `date` falls in, using UTC. */
export function quarterOf(date: Date): Quarter {
  return {
    year: date.getUTCFullYear(),
    quarter: (Math.floor(date.getUTCMonth() / 3) + 1) as Quarter['quarter'],
  };
}

export function isFutureQuarter(value: string, now: Date = new Date()): boolean {
  return toIndex(parseQuarter(value)) > toIndex(quarterOf(now));
}

function toIndex({ year, quarter }: Quarter): number {
  return year * 4 + (quarter - 1);
}
