import type { Transaction } from '../models/transaction.js';

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

export interface MerchantCategoryTotal extends MerchantTotal {
  category: string;
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

export interface AverageMonthlySpending {
  averageMonthlySpending: number;
  totalSpending: number;
  monthCount: number;
  monthlyExpenses: Array<{
    month: string;
    expenses: number;
  }>;
}

export interface MedianMonthlySpending {
  medianMonthlySpending: number;
  totalSpending: number;
  monthCount: number;
  monthlyExpenses: Array<{
    month: string;
    expenses: number;
  }>;
}

export interface IndividualPurchase {
  date: Date;
  merchant: string;
  category: string;
  amount: number;
  account?: string;
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

  /** Groups spending or income by merchant and category. */
  groupByMerchantAndCategory(transactions: Transaction[]): MerchantCategoryTotal[] {
    const totals = new Map<string, MerchantCategoryTotal>();

    for (const transaction of transactions) {
      const key = `${transaction.merchant.toLowerCase()}::${transaction.category.toLowerCase()}`;
      const current = totals.get(key) ?? {
        merchant: transaction.merchant,
        category: transaction.category,
        total: 0,
        count: 0,
      };

      current.total = roundMoney(current.total + transaction.amount);
      current.count += 1;
      totals.set(key, current);
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

  /** Calculates average monthly spending from expense transactions. */
  averageMonthlySpending(transactions: Transaction[]): AverageMonthlySpending {
    const monthlyExpenses = this.monthlyExpenseTotals(transactions);
    const totalSpending = roundMoney(
      monthlyExpenses.reduce((total, monthlyTotal) => total + monthlyTotal.expenses, 0),
    );
    const monthCount = monthlyExpenses.length;

    return {
      averageMonthlySpending: monthCount === 0 ? 0 : roundMoney(totalSpending / monthCount),
      totalSpending,
      monthCount,
      monthlyExpenses,
    };
  }

  /** Calculates median monthly spending from expense transactions. */
  medianMonthlySpending(transactions: Transaction[]): MedianMonthlySpending {
    const monthlyExpenses = this.monthlyExpenseTotals(transactions);
    const totalSpending = roundMoney(
      monthlyExpenses.reduce((total, monthlyTotal) => total + monthlyTotal.expenses, 0),
    );
    const sortedExpenses = monthlyExpenses
      .map((monthlyTotal) => monthlyTotal.expenses)
      .sort((a, b) => a - b);
    const monthCount = sortedExpenses.length;

    return {
      medianMonthlySpending: monthCount === 0 ? 0 : median(sortedExpenses),
      totalSpending,
      monthCount,
      monthlyExpenses,
    };
  }

  /** Returns the largest individual expense transactions. */
  biggestIndividualPurchases(transactions: Transaction[], limit = 5): IndividualPurchase[] {
    return transactions
      .filter((transaction) => transaction.amount < 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, limit)
      .map((transaction) => ({
        date: transaction.date,
        merchant: transaction.merchant,
        category: transaction.category,
        amount: transaction.amount,
        ...(transaction.account ? { account: transaction.account } : {}),
      }));
  }

  private monthlyExpenseTotals(
    transactions: Transaction[],
  ): Array<{ month: string; expenses: number }> {
    return this.monthlyTotals(transactions)
      .filter((total) => total.expenses > 0)
      .map((total) => ({
        month: total.month,
        expenses: total.expenses,
      }));
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function median(sortedValues: number[]): number {
  const midpoint = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[midpoint] ?? 0;
  }

  return roundMoney(((sortedValues[midpoint - 1] ?? 0) + (sortedValues[midpoint] ?? 0)) / 2);
}
