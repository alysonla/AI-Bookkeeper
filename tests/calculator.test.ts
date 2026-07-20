import { describe, expect, it } from 'vitest';
import type { Transaction } from '../src/models/transaction.js';
import { CalculatorService } from '../src/services/calculator.js';

const transactions: Transaction[] = [
  { date: new Date('2026-01-01'), merchant: 'Costco', category: 'Groceries', amount: -100.25 },
  { date: new Date('2026-01-02'), merchant: 'Costco', category: 'Groceries', amount: -40 },
  { date: new Date('2026-01-03'), merchant: 'Client A', category: 'Income', amount: 500 },
];

describe('CalculatorService', () => {
  const calculator = new CalculatorService();

  it('sums transaction amounts', () => {
    expect(calculator.sum(transactions)).toBe(359.75);
  });

  it('calculates cash flow with positive expenses', () => {
    expect(calculator.cashFlow(transactions)).toEqual({
      income: 500,
      expenses: 140.25,
      net: 359.75,
    });
  });

  it('groups by merchant', () => {
    expect(calculator.groupByMerchant(transactions)).toEqual([
      { merchant: 'Client A', total: 500, count: 1 },
      { merchant: 'Costco', total: -140.25, count: 2 },
    ]);
  });
});
