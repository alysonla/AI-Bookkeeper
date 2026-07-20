import type { Transaction } from '../models/transaction.js';
import type { StructuredIntent } from '../types/intent.js';
import { isWithinDateRange, resolveDateRange } from '../utils/dates.js';
import type { CalculatorService } from './calculator.js';

export interface IntentProcessorResult {
  result: unknown;
  transactionCount: number;
}

export class IntentService {
  constructor(private readonly calculator: CalculatorService) {}

  /** Applies a structured intent to normalized transactions using deterministic code only. */
  processIntent(
    intent: StructuredIntent,
    transactions: Transaction[],
    now = new Date(),
  ): IntentProcessorResult {
    const dateRange = resolveDateRange(intent.dateRange, now, intent.startDate, intent.endDate);
    const scopedTransactions = transactions.filter((transaction) =>
      isWithinDateRange(transaction.date, dateRange),
    );

    const filteredTransactions = this.filterByIntent(intent, scopedTransactions);

    switch (intent.intent) {
      case 'sum_category':
      case 'sum_merchant':
      case 'income_total':
      case 'expense_total':
        return {
          result: this.calculator.sum(filteredTransactions),
          transactionCount: filteredTransactions.length,
        };
      case 'cash_flow':
        return {
          result: this.calculator.cashFlow(filteredTransactions),
          transactionCount: filteredTransactions.length,
        };
      case 'biggest_expenses':
        return {
          result: this.calculator
            .groupByMerchant(filteredTransactions.filter((transaction) => transaction.amount < 0))
            .slice(0, intent.limit ?? 5),
          transactionCount: filteredTransactions.length,
        };
      case 'monthly_totals':
        return {
          result: this.calculator.monthlyTotals(filteredTransactions),
          transactionCount: filteredTransactions.length,
        };
      case 'unknown':
        return {
          result: {
            message: 'I could not determine which bookkeeping calculation to run.',
          },
          transactionCount: 0,
        };
    }
  }

  private filterByIntent(intent: StructuredIntent, transactions: Transaction[]): Transaction[] {
    if (intent.intent === 'sum_category' && intent.category) {
      return transactions.filter(
        (transaction) => transaction.category.toLowerCase() === intent.category?.toLowerCase(),
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
}
