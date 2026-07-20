import { describe, expect, it } from 'vitest';
import { resolveDateRange } from '../src/utils/dates.js';

describe('resolveDateRange', () => {
  it('resolves last_3_months as the three completed months before the current month', () => {
    const range = resolveDateRange('last_3_months', new Date('2026-07-19T12:00:00Z'));

    expect(range.start).toEqual(new Date(2026, 3, 1));
    expect(range.end).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it('resolves last_6_months as the six completed months before the current month', () => {
    const range = resolveDateRange('last_6_months', new Date('2026-07-19T12:00:00Z'));

    expect(range.start).toEqual(new Date(2026, 0, 1));
    expect(range.end).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it('resolves custom month names when explicit custom dates are missing', () => {
    const range = resolveDateRange(
      'custom',
      new Date('2026-07-19T12:00:00Z'),
      undefined,
      undefined,
      'list out the total for all categories for the month of march',
    );

    expect(range.start).toEqual(new Date(2026, 2, 1));
    expect(range.end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
  });

  it('uses the previous year for future month names without an explicit year', () => {
    const range = resolveDateRange(
      'custom',
      new Date('2026-01-15T12:00:00Z'),
      undefined,
      undefined,
      'show me December totals',
    );

    expect(range.start).toEqual(new Date(2025, 11, 1));
    expect(range.end).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });
});
