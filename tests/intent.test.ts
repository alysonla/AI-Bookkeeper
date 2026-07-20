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
      currency: 'USD',
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
      currency: 'USD',
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
      currency: 'USD',
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
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(3);
  });

  it('forces explicitly named food categories when the model returns broad expenses', () => {
    const result = service.processIntent(
      {
        intent: 'expense_total',
        dateRange: 'last_6_months',
      },
      transactions,
      new Date('2026-07-19'),
      'what was my total food spending on Groceries + Eating out for the last 6 months?',
    );

    expect(result.result).toEqual({
      operation: 'category_sum',
      totalSpending: 260,
      signedTotal: -260,
      includedCategories: ['Groceries', 'Eating Out'],
      categories: [
        { category: 'Groceries', total: -200, count: 2 },
        { category: 'Dining', total: -60, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(3);
  });

  it('groups explicitly named food category spending by month', () => {
    const result = service.processIntent(
      {
        intent: 'expense_total',
        dateRange: 'last_6_months',
      },
      [
        {
          date: new Date(2026, 0, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -100,
        },
        {
          date: new Date(2026, 0, 10),
          merchant: 'Cafe',
          category: 'Dining',
          amount: -40,
        },
        {
          date: new Date(2026, 2, 3),
          merchant: 'Target',
          category: 'Groceries',
          amount: -120,
        },
        {
          date: new Date(2026, 5, 2),
          merchant: 'Restaurant',
          category: 'Eating Out',
          amount: -60,
        },
        {
          date: new Date(2026, 6, 2),
          merchant: 'July Cafe',
          category: 'Eating Out',
          amount: -90,
        },
        {
          date: new Date(2026, 2, 5),
          merchant: 'Bank Transfer',
          category: 'Transfer',
          amount: -1000,
        },
      ],
      new Date(2026, 6, 20),
      'ok what is my total food costs (eating out + groceries) each month for the last 6 months?',
    );

    expect(result.result).toEqual({
      operation: 'monthly_category_sum',
      totalSpending: 320,
      signedTotal: -320,
      includedCategories: ['Groceries', 'Eating Out'],
      monthlyTotals: [
        { month: '2026-01', totalSpending: 140, signedTotal: -140, transactionCount: 2 },
        { month: '2026-02', totalSpending: 0, signedTotal: 0, transactionCount: 0 },
        { month: '2026-03', totalSpending: 120, signedTotal: -120, transactionCount: 1 },
        { month: '2026-04', totalSpending: 0, signedTotal: 0, transactionCount: 0 },
        { month: '2026-05', totalSpending: 0, signedTotal: 0, transactionCount: 0 },
        { month: '2026-06', totalSpending: 60, signedTotal: -60, transactionCount: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(4);
  });

  it('forces an explicitly named category sum when the model returns unknown', () => {
    const result = service.processIntent(
      {
        intent: 'unknown',
        dateRange: 'all_time',
      },
      [
        {
          date: new Date(2026, 5, 4),
          merchant: 'Rupa Labs',
          category: 'Health',
          amount: -75,
        },
        {
          date: new Date(2026, 5, 10),
          merchant: 'Prime IV',
          category: 'Health',
          amount: -25,
        },
        {
          date: new Date(2026, 5, 12),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
        {
          date: new Date(2026, 6, 1),
          merchant: 'Doctor',
          category: 'Health',
          amount: -40,
        },
      ],
      new Date('2026-07-19'),
      'whats the total for health transactions in June?',
    );

    expect(result.result).toEqual({
      operation: 'category_sum',
      totalSpending: 100,
      signedTotal: -100,
      includedCategories: ['Health'],
      categories: [{ category: 'Health', total: -100, count: 2 }],
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(2);
  });

  it('forces total spending from source text when the model returns unknown', () => {
    const result = service.processIntent(
      {
        intent: 'unknown',
        dateRange: 'all_time',
      },
      [
        {
          date: new Date(2026, 6, 1),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -25,
        },
        {
          date: new Date(2026, 6, 2),
          merchant: 'Target',
          category: 'Groceries',
          amount: -75,
        },
        {
          date: new Date(2026, 6, 3),
          merchant: 'Bank Transfer',
          category: 'Transfer',
          amount: -1000,
        },
        {
          date: new Date(2026, 5, 30),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -40,
        },
      ],
      new Date(2026, 6, 20),
      'how much have I spent total in July so far?',
    );

    expect(result.result).toEqual({
      operation: 'total_spending',
      totalSpending: 100,
      signedTotal: -100,
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(2);
  });

  it('compares last month spending to this month so far deterministically', () => {
    const result = service.processIntent(
      {
        intent: 'expense_total',
        dateRange: 'last_month',
      },
      [
        {
          date: new Date(2026, 5, 1),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -100,
        },
        {
          date: new Date(2026, 5, 2),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -50,
        },
        {
          date: new Date(2026, 6, 1),
          merchant: 'Target',
          category: 'Groceries',
          amount: -80,
        },
        {
          date: new Date(2026, 6, 2),
          merchant: 'Bank Transfer',
          category: 'Transfer',
          amount: -1000,
        },
      ],
      new Date(2026, 6, 20),
      'what was my total spending last month compared to this month so far?',
    );

    expect(result.result).toEqual({
      operation: 'period_spending_comparison',
      periods: [
        {
          label: 'last_month',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          totalSpending: 150,
          signedTotal: -150,
          transactionCount: 2,
        },
        {
          label: 'this_month_so_far',
          startDate: '2026-07-01',
          endDate: '2026-07-20',
          totalSpending: 80,
          signedTotal: -80,
          transactionCount: 1,
        },
      ],
      difference: 70,
      direction: 'lower',
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
    expect(result.transactionCount).toBe(3);
  });

  it('lists explicitly named category transactions when the model returns unknown', () => {
    const marchTransactions: Transaction[] = [
      {
        date: new Date(2026, 2, 31),
        merchant: 'The Home Depot',
        category: 'Home Maintenance',
        amount: -30.39,
        account: 'Delta SkyMiles Gold Card',
      },
      {
        date: new Date(2026, 2, 30),
        merchant: 'Y.a Home Services',
        category: 'Home Maintenance',
        amount: -698.62,
        account: 'Delta SkyMiles Gold Card',
      },
      {
        date: new Date(2026, 2, 22),
        merchant: 'Pharmacy',
        category: 'Health',
        amount: -40,
      },
      {
        date: new Date(2026, 3, 1),
        merchant: 'Hardware Store',
        category: 'Home Maintenance',
        amount: -25,
      },
    ];

    const result = service.processIntent(
      {
        intent: 'unknown',
        dateRange: 'all_time',
      },
      marchTransactions,
      new Date('2026-07-19'),
      'list out each of the home maintenance transactions in March',
    );

    expect(result.result).toEqual([
      {
        date: new Date(2026, 2, 31),
        merchant: 'The Home Depot',
        category: 'Home Maintenance',
        amount: -30.39,
        account: 'Delta SkyMiles Gold Card',
      },
      {
        date: new Date(2026, 2, 30),
        merchant: 'Y.a Home Services',
        category: 'Home Maintenance',
        amount: -698.62,
        account: 'Delta SkyMiles Gold Card',
      },
    ]);
    expect(result.transactionCount).toBe(2);
    expect(result.sourceTransactions).toHaveLength(3);
  });

  it('does not collapse comparison questions into a combined category sum', () => {
    const result = service.processIntent(
      {
        intent: 'category_expense_comparison',
        categories: ['Groceries', 'Eating Out'],
        dateRange: 'last_6_months',
      },
      transactions,
      new Date('2026-07-19'),
      'compare groceries versus eating out for the last 6 months',
    );

    expect(result.result).toEqual({
      categories: [
        { category: 'Groceries', total: -200, count: 2 },
        { category: 'Dining', total: -60, count: 1 },
      ],
      excludedCategories: ['transfer', 'transfers'],
      currency: 'USD',
    });
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
      currency: 'USD',
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
      currency: 'USD',
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
      currency: 'USD',
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
