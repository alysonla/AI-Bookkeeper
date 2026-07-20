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

  it('groups by merchant and category', () => {
    expect(
      calculator.groupByMerchantAndCategory([
        { date: new Date('2026-01-01'), merchant: 'Target', category: 'Kids', amount: -100 },
        { date: new Date('2026-01-02'), merchant: 'Target', category: 'Home', amount: -40 },
        { date: new Date('2026-01-03'), merchant: 'Target', category: 'Kids', amount: -25 },
      ]),
    ).toEqual([
      { merchant: 'Target', category: 'Kids', total: -125, count: 2 },
      { merchant: 'Target', category: 'Home', total: -40, count: 1 },
    ]);
  });

  it('calculates average monthly spending', () => {
    expect(
      calculator.averageMonthlySpending([
        { date: new Date('2026-01-01'), merchant: 'Rent', category: 'Housing', amount: -1000 },
        { date: new Date('2026-01-02'), merchant: 'Store', category: 'Groceries', amount: -200 },
        { date: new Date('2026-02-01'), merchant: 'Rent', category: 'Housing', amount: -900 },
      ]),
    ).toEqual({
      averageMonthlySpending: 1050,
      totalSpending: 2100,
      monthCount: 2,
      monthlyExpenses: [
        { month: '2026-01', expenses: 1200 },
        { month: '2026-02', expenses: 900 },
      ],
    });
  });

  it('groups monthly expenses by category', () => {
    expect(
      calculator.monthlyExpensesByCategory([
        { date: new Date('2026-01-01'), merchant: 'Costco', category: 'Groceries', amount: -100 },
        { date: new Date('2026-01-03'), merchant: 'Cafe', category: 'Eating Out', amount: -40 },
        { date: new Date('2026-01-04'), merchant: 'Cafe', category: 'Eating Out', amount: -25 },
        { date: new Date('2026-02-01'), merchant: 'Costco', category: 'Groceries', amount: -80 },
        { date: new Date('2026-02-02'), merchant: 'Paycheck', category: 'Income', amount: 1000 },
      ]),
    ).toEqual([
      { month: '2026-01', category: 'Eating Out', expenses: 65, count: 2 },
      { month: '2026-01', category: 'Groceries', expenses: 100, count: 1 },
      { month: '2026-02', category: 'Groceries', expenses: 80, count: 1 },
    ]);
  });

  it('calculates median monthly spending', () => {
    expect(
      calculator.medianMonthlySpending([
        { date: new Date('2026-01-01'), merchant: 'Rent', category: 'Housing', amount: -1000 },
        { date: new Date('2026-01-02'), merchant: 'Store', category: 'Groceries', amount: -200 },
        { date: new Date('2026-02-01'), merchant: 'Rent', category: 'Housing', amount: -900 },
        { date: new Date('2026-03-01'), merchant: 'Rent', category: 'Housing', amount: -1500 },
        { date: new Date('2026-04-01'), merchant: 'Rent', category: 'Housing', amount: -700 },
      ]),
    ).toEqual({
      medianMonthlySpending: 1050,
      totalSpending: 4300,
      monthCount: 4,
      monthlyExpenses: [
        { month: '2026-01', expenses: 1200 },
        { month: '2026-02', expenses: 900 },
        { month: '2026-03', expenses: 1500 },
        { month: '2026-04', expenses: 700 },
      ],
    });
  });

  it('returns biggest individual purchases', () => {
    expect(
      calculator.biggestIndividualPurchases([
        { date: new Date('2026-01-01'), merchant: 'Vet', category: 'Pets', amount: -500 },
        { date: new Date('2026-01-02'), merchant: 'Target', category: 'Home', amount: -100 },
        { date: new Date('2026-01-03'), merchant: 'Paycheck', category: 'Income', amount: 1000 },
      ]),
    ).toEqual([
      {
        date: new Date('2026-01-01'),
        merchant: 'Vet',
        category: 'Pets',
        amount: -500,
      },
      {
        date: new Date('2026-01-02'),
        merchant: 'Target',
        category: 'Home',
        amount: -100,
      },
    ]);
  });
});
