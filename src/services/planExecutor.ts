import type { Transaction } from '../models/transaction.js';
import type { CalculationPlan } from '../types/calculationPlan.js';
import { matchesCategory, normalizeCategory } from '../utils/categories.js';
import { isWithinDateRange, resolveDateRange } from '../utils/dates.js';
import type { ConversationContext } from './conversation.js';
import type { CalculatorService } from './calculator.js';

export interface PlanExecutionResult {
  result: unknown;
  transactionCount: number;
  transactions: Transaction[];
  sourceTransactions?: Transaction[];
}

export class PlanExecutorService {
  constructor(private readonly calculator: CalculatorService) {}

  execute(
    plan: CalculationPlan,
    context: ConversationContext,
    sourceText?: string,
  ): PlanExecutionResult | undefined {
    if (plan.operation === 'unknown') {
      return undefined;
    }

    if (plan.source === 'previous_result') {
      return this.executePreviousResultPlan(plan, context);
    }

    if (plan.source === 'previous_transactions') {
      return this.executePreviousTransactionsPlan(plan, context, sourceText);
    }

    return undefined;
  }

  private executePreviousResultPlan(
    plan: CalculationPlan,
    context: ConversationContext,
  ): PlanExecutionResult | undefined {
    if (plan.operation === 'answer_from_previous_result') {
      return this.executePreviousResultAnswerPlan(context);
    }

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
      sourceTransactions: context.sourceTransactions ?? context.transactions,
    };
  }

  private executePreviousResultAnswerPlan(
    context: ConversationContext,
  ): PlanExecutionResult | undefined {
    if (context.lastResult === undefined) {
      return undefined;
    }

    return {
      result: {
        previousQuestion: context.lastQuestion ?? null,
        previousResult: context.lastResult,
      },
      transactionCount: context.transactionCount ?? context.transactions.length,
      transactions: context.transactions,
      sourceTransactions: context.sourceTransactions ?? context.transactions,
    };
  }

  private executePreviousTransactionsPlan(
    plan: CalculationPlan,
    context: ConversationContext,
    sourceText?: string,
  ): PlanExecutionResult | undefined {
    const sourceTransactions = context.sourceTransactions ?? context.transactions;
    const baseTransactions = shouldUseSourceTransactions(context, sourceText)
      ? sourceTransactions
      : context.transactions;
    const transactions = applyFilters(baseTransactions, plan, context.createdAt, sourceText);

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
          sourceTransactions,
        };
      }
      case 'count':
        return {
          result: this.calculator.count(transactions),
          transactionCount: transactions.length,
          transactions,
          sourceTransactions,
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
          sourceTransactions,
        };
      }
      case 'group_by':
        return {
          result: this.groupTransactions(transactions, plan),
          transactionCount: transactions.length,
          transactions,
          sourceTransactions,
        };
      case 'list':
        return {
          result: transactions.slice(0, plan.limit ?? 12),
          transactionCount: transactions.length,
          transactions,
          sourceTransactions,
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
      sourceTransactions: context.sourceTransactions ?? context.transactions,
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

function applyFilters(
  transactions: Transaction[],
  plan: CalculationPlan,
  now: Date,
  sourceText?: string,
): Transaction[] {
  const excludeCategories = new Set(
    (plan.filters?.excludeCategories ?? ['transfer', 'transfers']).map((category) =>
      normalizeCategory(category),
    ),
  );
  const textDateRange = sourceText
    ? resolveDateRange('all_time', now, undefined, undefined, sourceText)
    : undefined;

  return transactions.filter((transaction) => {
    if (textDateRange && !isWithinDateRange(transaction.date, textDateRange)) {
      return false;
    }

    if (excludeCategories.has(normalizeCategory(transaction.category))) {
      return false;
    }

    if (plan.filters?.category && !matchesCategory(transaction.category, plan.filters.category)) {
      return false;
    }

    if (plan.filters?.categories?.length) {
      const categories = new Set(
        plan.filters.categories.map((category) => normalizeCategory(category)),
      );

      if (!categories.has(normalizeCategory(transaction.category))) {
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

function shouldUseSourceTransactions(context: ConversationContext, sourceText?: string): boolean {
  if (!sourceText || !context.sourceTransactions) {
    return false;
  }

  const normalizedText = sourceText.toLowerCase();
  const mentionsCategory = /\bcategor(?:y|ies)\b/.test(normalizedText);
  const mentionsMonth =
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(
      normalizedText,
    );

  return mentionsCategory && mentionsMonth;
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
