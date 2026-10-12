import { formatQuarter, isFutureQuarter, parseQuarter, quarterOf } from './quarter';

describe('quarter', () => {
  it('parses a valid quarter', () => {
    expect(parseQuarter('2026-Q4')).toEqual({ year: 2026, quarter: 4 });
  });

  it.each(['2026-Q5', '2026-Q0', '2026Q1', '26-Q1', '2026-q1', ''])('rejects "%s"', (value) => {
    expect(() => parseQuarter(value)).toThrow();
  });

  it('formats a quarter', () => {
    expect(formatQuarter({ year: 2026, quarter: 1 })).toBe('2026-Q1');
  });

  it('finds the quarter of a date', () => {
    expect(quarterOf(new Date('2026-01-01T00:00:00Z'))).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf(new Date('2026-06-30T23:59:59Z'))).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf(new Date('2026-10-12T00:00:00Z'))).toEqual({ year: 2026, quarter: 4 });
  });

  it('detects future quarters', () => {
    const now = new Date('2026-10-12T00:00:00Z');

    expect(isFutureQuarter('2026-Q4', now)).toBe(false);
    expect(isFutureQuarter('2026-Q3', now)).toBe(false);
    expect(isFutureQuarter('2027-Q1', now)).toBe(true);
  });
});
