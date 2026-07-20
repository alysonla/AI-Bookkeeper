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
});
