import type { Transaction } from '../models/transaction.js';
import type { CalculationPlan } from '../types/calculationPlan.js';
import type { ConversationContext } from './conversation.js';
import type { CalculatorService } from './calculator.js';

export interface PlanExecutionResult {
  result: unknown;
  transactionCount: number;
  transactions: Transaction[];
}

export class PlanExecutorService {
  constructor(private readonly calculator: CalculatorService) {}

  execute(plan: CalculationPlan, context: ConversationContext): PlanExecutionResult | undefined {
    if (plan.operation === 'unknown') {
      return undefined;
    }

    if (plan.source === 'previous_result') {
      return this.executePreviousResultPlan(plan, context);
    }

    if (plan.source === 'previous_transactions') {
      return this.executePreviousTransactionsPlan(plan, context);
    }

    return undefined;
  }

  private executePreviousResultPlan(
    plan: CalculationPlan,
    context: ConversationContext,
  ): PlanExecutionResult | undefined {
    if (plan.operation === 'median') {
      return this.executePreviousMonthlyMedianPlan(context);
    }

    if (
      (plan.operation !== 'average' && plan.operation !== 'derive_from_previous') ||
      typeof context.lastNumericResult !== 'number' ||
      typeof plan.divisor !== 'number'
    ) {
      return undefined;
    }

    const baseValue =
      plan.metric === 'expenses' ? Math.abs(context.lastNumericResult) : context.lastNumericResult;
    const average = roundMoney(baseValue / plan.divisor);

    return {
      result: {
        value: average,
        operation: 'average',
        divisor: plan.divisor,
        sourceValue: baseValue,
        approximate: plan.approximate ?? false,
      },
      transactionCount: context.transactions.length,
      transactions: context.transactions,
    };
  }

  private executePreviousTransactionsPlan(
    plan: CalculationPlan,
    context: ConversationContext,
  ): PlanExecutionResult | undefined {
    const transactions = applyFilters(context.transactions, plan);

    switch (plan.operation) {
      case 'sum': {
        const metricTransactions = selectMetricTransactions(transactions, plan);
        return {
          result:
            plan.metric === 'expenses'
              ? {
                  totalSpending: Math.abs(this.calculator.sum(metricTransactions)),
                  signedTotal: this.calculator.sum(metricTransactions),
                  excludedCategories: plan.filters?.excludeCategories ?? ['transfer', 'transfers'],
                }
              : this.calculator.sum(metricTransactions),
          transactionCount: metricTransactions.length,
          transactions: metricTransactions,
        };
      }
      case 'count':
        return {
          result: this.calculator.count(transactions),
          transactionCount: transactions.length,
          transactions,
        };
      case 'median': {
        const metricTransactions = selectMetricTransactions(transactions, plan);
        return {
          result:
            plan.metric === 'expenses'
              ? {
                  ...this.calculator.medianMonthlySpending(metricTransactions),
                  excludedCategories: plan.filters?.excludeCategories ?? ['transfer', 'transfers'],
                }
              : this.calculator.medianMonthlySpending(metricTransactions),
          transactionCount: metricTransactions.length,
          transactions: metricTransactions,
        };
      }
      case 'group_by':
        return {
          result: this.groupTransactions(transactions, plan),
          transactionCount: transactions.length,
          transactions,
        };
      case 'list':
        return {
          result: transactions.slice(0, plan.limit ?? 12),
          transactionCount: transactions.length,
          transactions,
        };
      default:
        return undefined;
    }
  }

  private executePreviousMonthlyMedianPlan(
    context: ConversationContext,
  ): PlanExecutionResult | undefined {
    const monthlyExpenses = extractMonthlyExpenses(context.lastResult);

    if (monthlyExpenses.length === 0) {
      return undefined;
    }

    const sortedExpenses = monthlyExpenses
      .map((monthlyTotal) => monthlyTotal.expenses)
      .sort((a, b) => a - b);
    const midpoint = Math.floor(sortedExpenses.length / 2);
    const medianMonthlySpending =
      sortedExpenses.length % 2 === 1
        ? (sortedExpenses[midpoint] ?? 0)
        : roundMoney(((sortedExpenses[midpoint - 1] ?? 0) + (sortedExpenses[midpoint] ?? 0)) / 2);
    const totalSpending = roundMoney(
      monthlyExpenses.reduce((total, monthlyTotal) => total + monthlyTotal.expenses, 0),
    );

    return {
      result: {
        medianMonthlySpending,
        totalSpending,
        monthCount: monthlyExpenses.length,
        monthlyExpenses,
        excludedCategories: ['transfer', 'transfers'],
      },
      transactionCount: context.transactionCount ?? context.transactions.length,
      transactions: context.transactions,
    };
  }

  private groupTransactions(transactions: Transaction[], plan: CalculationPlan): unknown {
    const metricTransactions = selectMetricTransactions(transactions, plan);

    switch (plan.groupBy) {
      case 'category':
        return this.calculator.groupByCategory(metricTransactions);
      case 'merchant':
        return this.calculator.groupByMerchant(metricTransactions);
      case 'merchant_category':
        return this.calculator.groupByMerchantAndCategory(metricTransactions);
      case 'month':
        return this.calculator.monthlyTotals(metricTransactions);
      case 'month_category':
        return this.calculator.monthlyExpensesByCategory(metricTransactions);
      default:
        return this.calculator.groupByCategory(metricTransactions);
    }
  }
}

function applyFilters(transactions: Transaction[], plan: CalculationPlan): Transaction[] {
  const excludeCategories = new Set(
    (plan.filters?.excludeCategories ?? ['transfer', 'transfers']).map((category) =>
      category.toLowerCase(),
    ),
  );

  return transactions.filter((transaction) => {
    if (excludeCategories.has(transaction.category.toLowerCase())) {
      return false;
    }

    if (
      plan.filters?.category &&
      transaction.category.toLowerCase() !== plan.filters.category.toLowerCase()
    ) {
      return false;
    }

    if (plan.filters?.categories?.length) {
      const categories = new Set(plan.filters.categories.map((category) => category.toLowerCase()));

      if (!categories.has(transaction.category.toLowerCase())) {
        return false;
      }
    }

    if (
      plan.filters?.merchant &&
      !transaction.merchant.toLowerCase().includes(plan.filters.merchant.toLowerCase())
    ) {
      return false;
    }

    return true;
  });
}

function selectMetricTransactions(
  transactions: Transaction[],
  plan: CalculationPlan,
): Transaction[] {
  if (plan.metric === 'income') {
    return transactions.filter((transaction) => transaction.amount > 0);
  }

  if (plan.metric === 'expenses') {
    return transactions.filter((transaction) => transaction.amount < 0);
  }

  return transactions;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function extractMonthlyExpenses(result: unknown): Array<{ month: string; expenses: number }> {
  if (!result || typeof result !== 'object') {
    return [];
  }

  const monthlyExpenses = (result as Record<string, unknown>).monthlyExpenses;

  if (!Array.isArray(monthlyExpenses)) {
    return [];
  }

  return monthlyExpenses.filter(
    (value): value is { month: string; expenses: number } =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).month === 'string' &&
      typeof (value as Record<string, unknown>).expenses === 'number',
  );
}
