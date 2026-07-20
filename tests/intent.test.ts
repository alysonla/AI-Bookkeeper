import { describe, expect, it } from 'vitest';
import type { Transaction } from '../src/models/transaction.js';
import { CalculatorService } from '../src/services/calculator.js';
import { IntentService } from '../src/services/intent.js';

const transactions: Transaction[] = [
  { date: new Date('2026-06-05'), merchant: 'Costco', category: 'Groceries', amount: -120 },
  { date: new Date('2026-06-10'), merchant: 'Whole Foods', category: 'Groceries', amount: -80 },
  { date: new Date('2026-07-01'), merchant: 'Client A', category: 'Income', amount: 1000 },
];

describe('IntentService', () => {
  const service = new IntentService(new CalculatorService());

  it('filters by category and date range before summing', () => {
    const result = service.processIntent(
      {
        intent: 'sum_category',
        category: 'Groceries',
        dateRange: 'last_month',
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result).toEqual({
      result: -200,
      transactionCount: 2,
    });
  });
});
