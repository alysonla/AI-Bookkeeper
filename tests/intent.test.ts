import { describe, expect, it } from 'vitest';
import type { Transaction } from '../src/models/transaction.js';
import { CalculatorService } from '../src/services/calculator.js';
import { IntentService } from '../src/services/intent.js';

const transactions: Transaction[] = [
  { date: new Date('2026-06-05'), merchant: 'Costco', category: 'Groceries', amount: -120 },
  { date: new Date('2026-06-10'), merchant: 'Whole Foods', category: 'Groceries', amount: -80 },
  { date: new Date('2026-05-10'), merchant: 'Cafe', category: 'Dining', amount: -60 },
  { date: new Date('2026-06-11'), merchant: 'Target', category: 'Kids', amount: -30 },
  { date: new Date('2026-06-12'), merchant: 'Target', category: 'Home', amount: -20 },
  { date: new Date('2026-06-13'), merchant: 'Vet', category: 'Milo', amount: -500 },
  { date: new Date('2026-07-01'), merchant: 'Client A', category: 'Income', amount: 1000 },
  { date: new Date('2026-07-02'), merchant: 'Bank Transfer', category: 'Transfer', amount: -5000 },
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

    expect(result.result).toBe(-200);
    expect(result.transactionCount).toBe(2);
    expect(result.transactions).toHaveLength(2);
  });

  it('excludes transfers from average monthly spending', () => {
    const result = service.processIntent(
      {
        intent: 'average_monthly_spending',
        dateRange: 'last_6_months',
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual({
      averageMonthlySpending: 405,
      totalSpending: 810,
      monthCount: 2,
      monthlyExpenses: [
        { month: '2026-05', expenses: 60 },
        { month: '2026-06', expenses: 750 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(6);
  });

  it('supports average monthly spending over the last three completed months', () => {
    const result = service.processIntent(
      {
        intent: 'average_monthly_spending',
        dateRange: 'last_3_months',
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual({
      averageMonthlySpending: 405,
      totalSpending: 810,
      monthCount: 2,
      monthlyExpenses: [
        { month: '2026-05', expenses: 60 },
        { month: '2026-06', expenses: 750 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
  });

  it('supports median monthly spending over the last six completed months', () => {
    const result = service.processIntent(
      {
        intent: 'median_monthly_spending',
        dateRange: 'last_6_months',
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual({
      medianMonthlySpending: 405,
      totalSpending: 810,
      monthCount: 2,
      monthlyExpenses: [
        { month: '2026-05', expenses: 60 },
        { month: '2026-06', expenses: 750 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(6);
  });

  it('compares expenses across requested categories', () => {
    const result = service.processIntent(
      {
        intent: 'category_expense_comparison',
        categories: ['grocery expense', 'eating-out expense'],
        dateRange: 'last_6_months',
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual({
      categories: [
        { category: 'Groceries', total: -200, count: 2 },
        { category: 'Dining', total: -60, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(3);
  });

  it('resolves month names from the question when custom intent dates are missing', () => {
    const result = service.processIntent(
      {
        intent: 'category_totals',
        dateRange: 'custom',
      },
      [
        { date: new Date(2026, 2, 1), merchant: 'Vet', category: 'Milo', amount: -100 },
        {
          date: new Date(2026, 2, 15),
          merchant: 'Hardware Store',
          category: 'Home Maintenance',
          amount: -50,
        },
        { date: new Date(2026, 3, 1), merchant: 'Cafe', category: 'Dining', amount: -25 },
      ],
      new Date('2026-07-19'),
      'list out the total for all categories for the month of march',
    );

    expect(result.result).toEqual({
      operation: 'category_totals',
      categories: [
        { category: 'Milo', total: -100, count: 1 },
        { category: 'Home Maintenance', total: -50, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(2);
  });

  it('treats all categories as category totals when the model returns sum_category', () => {
    const result = service.processIntent(
      {
        intent: 'sum_category',
        category: 'all categories',
        dateRange: 'custom',
      },
      [
        { date: new Date(2026, 2, 1), merchant: 'Vet', category: 'Milo', amount: -100 },
        {
          date: new Date(2026, 2, 15),
          merchant: 'Hardware Store',
          category: 'Home Maintenance',
          amount: -50,
        },
        { date: new Date(2026, 2, 20), merchant: 'Bank', category: 'Transfer', amount: -500 },
        { date: new Date(2026, 3, 1), merchant: 'Cafe', category: 'Dining', amount: -25 },
      ],
      new Date('2026-07-19'),
      'list out the total for all categories for the month of march',
    );

    expect(result.result).toEqual({
      operation: 'category_totals',
      categories: [
        { category: 'Milo', total: -100, count: 1 },
        { category: 'Home Maintenance', total: -50, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(2);
  });

  it('forces category totals from source text when the model returns the wrong intent', () => {
    const result = service.processIntent(
      {
        intent: 'monthly_totals',
        dateRange: 'all_time',
      },
      [
        { date: new Date(2026, 2, 1), merchant: 'Vet', category: 'Milo', amount: -100 },
        {
          date: new Date(2026, 2, 15),
          merchant: 'Hardware Store',
          category: 'Home Maintenance',
          amount: -50,
        },
        { date: new Date(2026, 3, 1), merchant: 'Cafe', category: 'Dining', amount: -25 },
      ],
      new Date('2026-07-19'),
      'list out the total for all categories for the month of march',
    );

    expect(result.result).toEqual({
      operation: 'category_totals',
      categories: [
        { category: 'Milo', total: -100, count: 1 },
        { category: 'Home Maintenance', total: -50, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result.transactionCount).toBe(2);
  });

  it('includes categories in biggest expense results', () => {
    const result = service.processIntent(
      {
        intent: 'biggest_expenses',
        dateRange: 'last_month',
        limit: 2,
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual([
      { merchant: 'Vet', category: 'Milo', total: -500, count: 1 },
      { merchant: 'Costco', category: 'Groceries', total: -120, count: 1 },
    ]);
  });

  it('returns transaction-level results for biggest individual purchases', () => {
    const result = service.processIntent(
      {
        intent: 'biggest_individual_purchases',
        dateRange: 'last_month',
        limit: 2,
      },
      transactions,
      new Date('2026-07-19'),
    );

    expect(result.result).toEqual([
      {
        date: new Date('2026-06-13'),
        merchant: 'Vet',
        category: 'Milo',
        amount: -500,
      },
      {
        date: new Date('2026-06-05'),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -120,
      },
    ]);
  });
});
