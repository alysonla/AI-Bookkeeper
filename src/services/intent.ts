import type { Transaction } from '../models/transaction.js';
import type { StructuredIntent } from '../types/intent.js';
import { matchesCategory, normalizeCategory } from '../utils/categories.js';
import { isWithinDateRange, resolveDateRange } from '../utils/dates.js';
import type { CalculatorService } from './calculator.js';

export interface IntentProcessorResult {
  result: unknown;
  transactionCount: number;
  transactions: Transaction[];
}

export class IntentService {
  constructor(private readonly calculator: CalculatorService) {}

  /** Applies a structured intent to normalized transactions using deterministic code only. */
  processIntent(
    intent: StructuredIntent,
    transactions: Transaction[],
    now = new Date(),
    sourceText?: string,
  ): IntentProcessorResult {
    const dateRange = resolveDateRange(
      intent.dateRange,
      now,
      intent.startDate,
      intent.endDate,
      sourceText,
    );
    const scopedTransactions = transactions.filter((transaction) =>
      isWithinDateRange(transaction.date, dateRange),
    );
    const nonTransferTransactions = scopedTransactions.filter(
      (transaction) => !isTransfer(transaction),
    );

    const filteredTransactions = this.filterByIntent(intent, nonTransferTransactions);

    if (sourceText && isCategoryTotalsQuestion(sourceText)) {
      return this.categoryTotals(filteredTransactions);
    }

    switch (intent.intent) {
      case 'sum_category':
        if (intent.category && isAllCategoryRequest(intent.category)) {
          return this.categoryTotals(filteredTransactions);
        }

        return {
          result: this.calculator.sum(filteredTransactions),
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      case 'sum_merchant':
      case 'income_total':
      case 'expense_total':
        return {
          result: this.calculator.sum(filteredTransactions),
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      case 'cash_flow':
        return {
          result: this.calculator.cashFlow(filteredTransactions),
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      case 'category_totals':
        return this.categoryTotals(filteredTransactions);
      case 'category_expense_comparison': {
        const expenseTransactions = filteredTransactions.filter(
          (transaction) => transaction.amount < 0,
        );

        return {
          result: {
            categories: this.calculator.groupByCategory(expenseTransactions),
            excludedCategories: ['transfer', 'transfers'],
          },
          transactionCount: expenseTransactions.length,
          transactions: expenseTransactions,
        };
      }
      case 'biggest_expenses':
        return {
          result: this.calculator
            .groupByMerchantAndCategory(
              filteredTransactions.filter((transaction) => transaction.amount < 0),
            )
            .slice(0, intent.limit ?? 5),
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      case 'biggest_individual_purchases': {
        const expenseTransactions = filteredTransactions.filter(
          (transaction) => transaction.amount < 0,
        );

        return {
          result: this.calculator.biggestIndividualPurchases(
            expenseTransactions,
            intent.limit ?? 5,
          ),
          transactionCount: expenseTransactions.length,
          transactions: expenseTransactions,
        };
      }
      case 'monthly_totals':
        return {
          result: this.calculator.monthlyTotals(filteredTransactions),
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      case 'average_monthly_spending': {
        const expenseTransactions = filteredTransactions.filter(
          (transaction) => transaction.amount < 0,
        );

        return {
          result: {
            ...this.calculator.averageMonthlySpending(expenseTransactions),
            excludedCategories: ['transfer', 'transfers'],
          },
          transactionCount: expenseTransactions.length,
          transactions: expenseTransactions,
        };
      }
      case 'median_monthly_spending': {
        const expenseTransactions = filteredTransactions.filter(
          (transaction) => transaction.amount < 0,
        );

        return {
          result: {
            ...this.calculator.medianMonthlySpending(expenseTransactions),
            excludedCategories: ['transfer', 'transfers'],
          },
          transactionCount: expenseTransactions.length,
          transactions: expenseTransactions,
        };
      }
      case 'unknown':
        return {
          result: {
            message: 'I could not determine which bookkeeping calculation to run.',
          },
          transactionCount: 0,
          transactions: [],
        };
    }
  }

  private filterByIntent(intent: StructuredIntent, transactions: Transaction[]): Transaction[] {
    if (
      intent.intent === 'sum_category' &&
      intent.category &&
      !isAllCategoryRequest(intent.category)
    ) {
      return transactions.filter((transaction) =>
        matchesCategory(transaction.category, intent.category ?? ''),
      );
    }

    if (intent.intent === 'category_expense_comparison' && intent.categories?.length) {
      const categories = new Set(intent.categories.map((category) => normalizeCategory(category)));
      return transactions.filter((transaction) =>
        categories.has(normalizeCategory(transaction.category)),
      );
    }

    if (intent.intent === 'sum_merchant' && intent.merchant) {
      return transactions.filter((transaction) =>
        transaction.merchant.toLowerCase().includes(intent.merchant?.toLowerCase() ?? ''),
      );
    }

    if (intent.intent === 'income_total') {
      return transactions.filter((transaction) => transaction.amount > 0);
    }

    if (intent.intent === 'expense_total') {
      return transactions.filter((transaction) => transaction.amount < 0);
    }

    return transactions;
  }

  private categoryTotals(transactions: Transaction[]): IntentProcessorResult {
    const expenseTransactions = transactions.filter((transaction) => transaction.amount < 0);

    return {
      result: {
        operation: 'category_totals',
        categories: this.calculator.groupByCategory(expenseTransactions),
        excludedCategories: ['transfer', 'transfers'],
      },
      transactionCount: expenseTransactions.length,
      transactions: expenseTransactions,
    };
  }
}

function isTransfer(transaction: Transaction): boolean {
  return normalizeCategory(transaction.category) === 'transfer';
}

function isAllCategoryRequest(category: string): boolean {
  return ['all', 'all category', 'all categories', 'every category', 'each category'].includes(
    normalizeCategory(category),
  );
}

function isCategoryTotalsQuestion(sourceText: string): boolean {
  const normalizedText = sourceText.toLowerCase();

  return (
    /\b(all|each|every)\s+categor(?:y|ies)\b/.test(normalizedText) ||
    /\bby\s+categor(?:y|ies)\b/.test(normalizedText) ||
    /\bcategor(?:y|ies)\s+totals?\b/.test(normalizedText) ||
    /\btotals?\s+for\s+(all|each|every)\s+categor(?:y|ies)\b/.test(normalizedText)
  );
}
