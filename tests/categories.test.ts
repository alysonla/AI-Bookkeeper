import { describe, expect, it } from 'vitest';
import { matchesCategory, normalizeCategory } from '../src/utils/categories.js';

describe('category matching utilities', () => {
  it('normalizes common spending category variants', () => {
    expect(normalizeCategory('grocery expenses')).toBe('groceries');
    expect(normalizeCategory('Groceries')).toBe('groceries');
    expect(normalizeCategory('eating-out expense')).toBe('dining');
    expect(normalizeCategory('Dining')).toBe('dining');
  });

  it('matches aliases across user language and sheet categories', () => {
    expect(matchesCategory('Dining', 'eating out')).toBe(true);
    expect(matchesCategory('Groceries', 'grocery expense')).toBe(true);
    expect(matchesCategory('Home', 'eating out')).toBe(false);
  });
});
