import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../src/services/conversation.js';
import { CalculatorService } from '../src/services/calculator.js';
import { PlanExecutorService } from '../src/services/planExecutor.js';

const transactions = [
  {
    date: new Date(2026, 0, 2),
    merchant: 'Costco',
    category: 'Groceries',
    amount: -120,
  },
  {
    date: new Date(2026, 0, 5),
    merchant: 'Target',
    category: 'Groceries',
    amount: -80,
  },
  {
    date: new Date(2026, 0, 8),
    merchant: 'Payroll',
    category: 'Income',
    amount: 5000,
  },
  {
    date: new Date(2026, 0, 10),
    merchant: 'Withdrawal Transfer to *4748',
    category: 'Transfer',
    amount: -500,
  },
];

describe('PlanExecutorService', () => {
  const service = new PlanExecutorService(new CalculatorService());

  it('derives a monthly average from the previous numeric result', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
      lastNumericResult: -49149.74,
      transactionCount: 665,
    };

    const result = service.execute(
      {
        source: 'previous_result',
        operation: 'average',
        metric: 'expenses',
        divisor: 6,
        approximate: true,
      },
      context,
    );

    expect(result?.result).toEqual({
      value: 8191.62,
      operation: 'average',
      divisor: 6,
      sourceValue: 49149.74,
      approximate: true,
    });
    expect(result?.transactionCount).toBe(4);
  });

  it('calculates median monthly spending from previous monthly result context', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
      transactionCount: 665,
      lastResult: {
        averageMonthlySpending: 8191.62,
        totalSpending: 49149.74,
        monthCount: 6,
        monthlyExpenses: [
          { month: '2026-01', expenses: 7747.55 },
          { month: '2026-02', expenses: 5289.81 },
          { month: '2026-03', expenses: 14220.5 },
          { month: '2026-04', expenses: 7866.1 },
          { month: '2026-05', expenses: 7857.12 },
          { month: '2026-06', expenses: 6168.66 },
        ],
      },
    };

    const result = service.execute(
      {
        source: 'previous_result',
        operation: 'median',
        metric: 'expenses',
      },
      context,
    );

    expect(result?.result).toEqual({
      medianMonthlySpending: 7802.34,
      totalSpending: 49149.74,
      monthCount: 6,
      monthlyExpenses: [
        { month: '2026-01', expenses: 7747.55 },
        { month: '2026-02', expenses: 5289.81 },
        { month: '2026-03', expenses: 14220.5 },
        { month: '2026-04', expenses: 7866.1 },
        { month: '2026-05', expenses: 7857.12 },
        { month: '2026-06', expenses: 6168.66 },
      ],
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result?.transactionCount).toBe(665);
  });

  it('returns previous results for observational follow-ups', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
      lastQuestion: 'list out the total for all categories for the month of march',
      lastResult: [
        { category: 'Milo', total: -3624.55, count: 2 },
        { category: 'Groceries', total: -1549.98, count: 24 },
        { category: 'Home Maintenance', total: -1440.01, count: 10 },
      ],
      transactionCount: 120,
    };

    const result = service.execute(
      {
        source: 'previous_result',
        operation: 'answer_from_previous_result',
      },
      context,
    );

    expect(result?.result).toEqual({
      previousQuestion: 'list out the total for all categories for the month of march',
      previousResult: [
        { category: 'Milo', total: -3624.55, count: 2 },
        { category: 'Groceries', total: -1549.98, count: 24 },
        { category: 'Home Maintenance', total: -1440.01, count: 10 },
      ],
    });
    expect(result?.transactionCount).toBe(120);
  });

  it('filters previous transactions and sums expenses without transfers', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
    };

    const result = service.execute(
      {
        source: 'previous_transactions',
        operation: 'sum',
        metric: 'expenses',
        filters: {
          merchant: 'Costco',
          excludeCategories: ['transfer', 'transfers'],
        },
      },
      context,
    );

    expect(result?.result).toEqual({
      totalSpending: 120,
      signedTotal: -120,
      excludedCategories: ['transfer', 'transfers'],
    });
    expect(result?.transactionCount).toBe(1);
  });

  it('groups previous expense transactions by category', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
    };

    const result = service.execute(
      {
        source: 'previous_transactions',
        operation: 'group_by',
        metric: 'expenses',
        groupBy: 'category',
      },
      context,
    );

    expect(result?.result).toEqual([
      {
        category: 'Groceries',
        total: -200,
        count: 2,
      },
    ]);
  });

  it('filters previous transactions to the month named in a category follow-up', () => {
    const context: ConversationContext = {
      transactions: [
        {
          date: new Date(2026, 0, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
        {
          date: new Date(2026, 2, 1),
          merchant: 'Vet',
          category: 'Milo',
          amount: -3624.55,
        },
        {
          date: new Date(2026, 2, 15),
          merchant: 'Hardware Store',
          category: 'Home Maintenance',
          amount: -1440.01,
        },
        {
          date: new Date(2026, 2, 18),
          merchant: 'Doctor',
          category: 'Health',
          amount: -1337.82,
        },
        {
          date: new Date(2026, 3, 2),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -75,
        },
      ],
      createdAt: new Date('2026-07-01'),
      transactionCount: 665,
      lastResult: {
        averageMonthlySpending: 8191.62,
        totalSpending: 49149.74,
        monthCount: 6,
        monthlyExpenses: [
          { month: '2026-01', expenses: 7747.55 },
          { month: '2026-02', expenses: 5289.81 },
          { month: '2026-03', expenses: 14220.5 },
          { month: '2026-04', expenses: 7866.1 },
          { month: '2026-05', expenses: 7857.12 },
          { month: '2026-06', expenses: 6168.66 },
        ],
      },
    };

    const result = service.execute(
      {
        source: 'previous_transactions',
        operation: 'group_by',
        metric: 'expenses',
        groupBy: 'category',
      },
      context,
      'what happened in March? can you list out each of the categories',
    );

    expect(result?.transactionCount).toBe(3);
    expect(result?.result).toEqual([
      { category: 'Milo', total: -3624.55, count: 1 },
      { category: 'Home Maintenance', total: -1440.01, count: 1 },
      { category: 'Health', total: -1337.82, count: 1 },
    ]);
  });

  it('groups previous compared categories by month and category', () => {
    const context: ConversationContext = {
      transactions: [
        {
          date: new Date(2026, 0, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -100,
        },
        {
          date: new Date(2026, 0, 10),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -40,
        },
        {
          date: new Date(2026, 1, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -80,
        },
      ],
      createdAt: new Date('2026-07-01'),
    };

    const result = service.execute(
      {
        source: 'previous_transactions',
        operation: 'group_by',
        metric: 'expenses',
        groupBy: 'month_category',
        filters: {
          categories: ['grocery expenses', 'eating-out expense'],
        },
      },
      context,
    );

    expect(result?.result).toEqual([
      { month: '2026-01', category: 'Eating Out', expenses: 40, count: 1 },
      { month: '2026-01', category: 'Groceries', expenses: 100, count: 1 },
      { month: '2026-02', category: 'Groceries', expenses: 80, count: 1 },
    ]);
    expect(result?.transactionCount).toBe(3);
  });

  it('does not execute unknown plans', () => {
    const context: ConversationContext = {
      transactions,
      createdAt: new Date('2026-07-01'),
    };

    expect(
      service.execute(
        {
          source: 'transactions',
          operation: 'unknown',
        },
        context,
      ),
    ).toBeUndefined();
  });
});
