import type { Transaction } from '../models/transaction.js';
import type { StructuredIntent } from '../types/intent.js';
import { matchesCategory, normalizeCategory } from '../utils/categories.js';
import { isWithinDateRange, resolveDateRange } from '../utils/dates.js';
import type { CalculatorService } from './calculator.js';

export interface IntentProcessorResult {
  result: unknown;
  transactionCount: number;
  transactions: Transaction[];
  sourceTransactions?: Transaction[];
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
    if (sourceText && isLastMonthToThisMonthComparison(sourceText)) {
      return this.lastMonthToThisMonthComparison(transactions, now);
    }

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

    const explicitCategories = sourceText ? extractExplicitCategories(sourceText) : [];

    if (sourceText && isTransactionListQuestion(sourceText)) {
      const category = findMentionedCategory(sourceText, nonTransferTransactions);

      if (category) {
        return this.transactionList(nonTransferTransactions, category);
      }
    }

    if (sourceText && explicitCategories.length > 0 && isCategorySumQuestion(sourceText)) {
      return this.categorySum(nonTransferTransactions, explicitCategories);
    }

    if (sourceText && isCategorySumQuestion(sourceText)) {
      const category = findMentionedCategory(sourceText, nonTransferTransactions);

      if (category) {
        return this.categorySum(nonTransferTransactions, [category]);
      }
    }

    const filteredTransactions = this.filterByIntent(intent, nonTransferTransactions);

    if (sourceText && isCategoryTotalsQuestion(sourceText)) {
      return this.categoryTotals(filteredTransactions);
    }

    if (sourceText && isTotalSpendingQuestion(sourceText)) {
      return this.expenseTotal(nonTransferTransactions);
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
            currency: 'USD',
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
            currency: 'USD',
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
            currency: 'USD',
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
        currency: 'USD',
      },
      transactionCount: expenseTransactions.length,
      transactions: expenseTransactions,
    };
  }

  private categorySum(transactions: Transaction[], categories: string[]): IntentProcessorResult {
    const expenseTransactions = transactions.filter(
      (transaction) =>
        transaction.amount < 0 &&
        categories.some((category) => matchesCategory(transaction.category, category)),
    );
    const signedTotal = this.calculator.sum(expenseTransactions);

    return {
      result: {
        operation: 'category_sum',
        totalSpending: Math.abs(signedTotal),
        signedTotal,
        includedCategories: categories,
        categories: this.calculator.groupByCategory(expenseTransactions),
        excludedCategories: ['transfer', 'transfers'],
        currency: 'USD',
      },
      transactionCount: expenseTransactions.length,
      transactions: expenseTransactions,
      sourceTransactions: transactions,
    };
  }

  private transactionList(transactions: Transaction[], category: string): IntentProcessorResult {
    const matchingTransactions = transactions
      .filter(
        (transaction) => transaction.amount < 0 && matchesCategory(transaction.category, category),
      )
      .sort((left, right) => right.date.getTime() - left.date.getTime());

    return {
      result: matchingTransactions,
      transactionCount: matchingTransactions.length,
      transactions: matchingTransactions,
      sourceTransactions: transactions,
    };
  }

  private expenseTotal(transactions: Transaction[]): IntentProcessorResult {
    const expenseTransactions = transactions.filter((transaction) => transaction.amount < 0);
    const signedTotal = this.calculator.sum(expenseTransactions);

    return {
      result: {
        operation: 'total_spending',
        totalSpending: Math.abs(signedTotal),
        signedTotal,
        excludedCategories: ['transfer', 'transfers'],
        currency: 'USD',
      },
      transactionCount: expenseTransactions.length,
      transactions: expenseTransactions,
    };
  }

  private lastMonthToThisMonthComparison(
    transactions: Transaction[],
    now: Date,
  ): IntentProcessorResult {
    const nonTransferTransactions = transactions.filter((transaction) => !isTransfer(transaction));
    const lastMonthRange = resolveDateRange('last_month', now);
    const thisMonthRange = resolveDateRange('this_month', now);
    const lastMonthTransactions = nonTransferTransactions.filter((transaction) =>
      isWithinDateRange(transaction.date, lastMonthRange),
    );
    const thisMonthTransactions = nonTransferTransactions.filter((transaction) =>
      isWithinDateRange(transaction.date, thisMonthRange),
    );
    const lastMonthExpenses = lastMonthTransactions.filter((transaction) => transaction.amount < 0);
    const thisMonthExpenses = thisMonthTransactions.filter((transaction) => transaction.amount < 0);
    const lastMonthSignedTotal = this.calculator.sum(lastMonthExpenses);
    const thisMonthSignedTotal = this.calculator.sum(thisMonthExpenses);

    return {
      result: {
        operation: 'period_spending_comparison',
        periods: [
          {
            label: 'last_month',
            startDate: formatDate(lastMonthRange.start),
            endDate: formatDate(lastMonthRange.end),
            totalSpending: Math.abs(lastMonthSignedTotal),
            signedTotal: lastMonthSignedTotal,
            transactionCount: lastMonthExpenses.length,
          },
          {
            label: 'this_month_so_far',
            startDate: formatDate(thisMonthRange.start),
            endDate: formatDate(now),
            totalSpending: Math.abs(thisMonthSignedTotal),
            signedTotal: thisMonthSignedTotal,
            transactionCount: thisMonthExpenses.length,
          },
        ],
        difference: Math.abs(
          Math.round((Math.abs(thisMonthSignedTotal) - Math.abs(lastMonthSignedTotal)) * 100) / 100,
        ),
        direction:
          Math.abs(thisMonthSignedTotal) > Math.abs(lastMonthSignedTotal)
            ? 'higher'
            : Math.abs(thisMonthSignedTotal) < Math.abs(lastMonthSignedTotal)
              ? 'lower'
              : 'same',
        excludedCategories: ['transfer', 'transfers'],
        currency: 'USD',
      },
      transactionCount: lastMonthExpenses.length + thisMonthExpenses.length,
      transactions: [...lastMonthExpenses, ...thisMonthExpenses],
      sourceTransactions: nonTransferTransactions,
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
    /\b(all|each|every)(?:\s+the)?\s+categor(?:y|ies)\b/.test(normalizedText) ||
    /\bby\s+categor(?:y|ies)\b/.test(normalizedText) ||
    /\bcategor(?:y|ies)\s+totals?\b/.test(normalizedText) ||
    /\btotals?\s+for\s+(all|each|every)(?:\s+the)?\s+categor(?:y|ies)\b/.test(normalizedText)
  );
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function extractExplicitCategories(sourceText: string): string[] {
  const normalizedText = sourceText.toLowerCase();
  const categories: string[] = [];

  if (/\bfood\b/.test(normalizedText)) {
    categories.push('Groceries', 'Eating Out');
  }

  if (/\bgrocer(?:y|ies)\b/.test(normalizedText)) {
    categories.push('Groceries');
  }

  if (/\b(?:eating\s*out|dining|restaurants?)\b/.test(normalizedText)) {
    categories.push('Eating Out');
  }

  return [...new Set(categories)];
}

function isCategorySumQuestion(sourceText: string): boolean {
  const normalizedText = sourceText.toLowerCase();

  if (/\b(?:compare|compared|versus|vs\.?)\b/.test(normalizedText)) {
    return false;
  }

  return /\b(?:total|spend|spending|spent|how much)\b/.test(normalizedText);
}

function isTotalSpendingQuestion(sourceText: string): boolean {
  const normalizedText = sourceText.toLowerCase();

  return (
    /\b(?:total|how much)\b/.test(normalizedText) &&
    /\b(?:spend|spending|spent)\b/.test(normalizedText)
  );
}

function isLastMonthToThisMonthComparison(sourceText: string): boolean {
  const normalizedText = sourceText.toLowerCase();

  return (
    /\b(?:compare|compared|versus|vs\.?)\b/.test(normalizedText) &&
    /\blast\s+month\b/.test(normalizedText) &&
    /\bthis\s+month(?:\s+so\s+far)?\b/.test(normalizedText)
  );
}

function isTransactionListQuestion(sourceText: string): boolean {
  return /\b(?:list|show)\b.*\btransactions?\b|\btransactions?\b.*\b(?:list|show)\b/.test(
    sourceText.toLowerCase(),
  );
}

function findMentionedCategory(
  sourceText: string,
  transactions: Transaction[],
): string | undefined {
  const normalizedText = normalizeCategory(sourceText);
  const categories = [...new Set(transactions.map((transaction) => transaction.category))].sort(
    (left, right) => right.length - left.length,
  );

  return categories.find((category) => {
    const normalizedCategory = normalizeCategory(category);

    return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedCategory)}(?:\\s|$)`).test(normalizedText);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
