import type { Transaction } from '../models/transaction.js';

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

export interface MonthlyTotal {
  month: string;
  income: number;
  expenses: number;
  cashFlow: number;
}

export class CalculatorService {
  /** Sums transaction amounts exactly as represented by the source data. */
  sum(transactions: Transaction[]): number {
    return roundMoney(transactions.reduce((total, transaction) => total + transaction.amount, 0));
  }

  /** Returns the average transaction amount, or 0 for an empty list. */
  average(transactions: Transaction[]): number {
    if (transactions.length === 0) {
      return 0;
    }

    return roundMoney(this.sum(transactions) / transactions.length);
  }

  /** Counts transactions in a deterministic, provider-agnostic way. */
  count(transactions: Transaction[]): number {
    return transactions.length;
  }

  /** Calculates income, expenses, and net cash flow. Expenses are returned as a positive value. */
  cashFlow(transactions: Transaction[]): { income: number; expenses: number; net: number } {
    const income = this.sum(transactions.filter((transaction) => transaction.amount > 0));
    const expenses = Math.abs(
      this.sum(transactions.filter((transaction) => transaction.amount < 0)),
    );

    return {
      income,
      expenses,
      net: roundMoney(income - expenses),
    };
  }

  /** Groups spending or income by merchant. */
  groupByMerchant(transactions: Transaction[]): MerchantTotal[] {
    const totals = new Map<string, MerchantTotal>();

    for (const transaction of transactions) {
      const current = totals.get(transaction.merchant) ?? {
        merchant: transaction.merchant,
        total: 0,
        count: 0,
      };

      current.total = roundMoney(current.total + transaction.amount);
      current.count += 1;
      totals.set(transaction.merchant, current);
    }

    return [...totals.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }

  /** Groups spending or income by bookkeeping category. */
  groupByCategory(transactions: Transaction[]): CategoryTotal[] {
    const totals = new Map<string, CategoryTotal>();

    for (const transaction of transactions) {
      const current = totals.get(transaction.category) ?? {
        category: transaction.category,
        total: 0,
        count: 0,
      };

      current.total = roundMoney(current.total + transaction.amount);
      current.count += 1;
      totals.set(transaction.category, current);
    }

    return [...totals.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }

  /** Returns monthly income, expenses, and net cash flow keyed by YYYY-MM. */
  monthlyTotals(transactions: Transaction[]): MonthlyTotal[] {
    const totals = new Map<string, MonthlyTotal>();

    for (const transaction of transactions) {
      const month = transaction.date.toISOString().slice(0, 7);
      const current = totals.get(month) ?? {
        month,
        income: 0,
        expenses: 0,
        cashFlow: 0,
      };

      if (transaction.amount >= 0) {
        current.income = roundMoney(current.income + transaction.amount);
      } else {
        current.expenses = roundMoney(current.expenses + Math.abs(transaction.amount));
      }

      current.cashFlow = roundMoney(current.income - current.expenses);
      totals.set(month, current);
    }

    return [...totals.values()].sort((a, b) => a.month.localeCompare(b.month));
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
