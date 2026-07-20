import type { Transaction } from '../models/transaction.js';
import { formatCurrency } from '../utils/currency.js';

export interface ConversationContext {
  transactions: Transaction[];
  createdAt: Date;
}

export class ConversationService {
  private readonly contexts = new Map<string, ConversationContext>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  saveBreakdownContext(userId: string, transactions: Transaction[], now = new Date()): void {
    this.contexts.set(userId, {
      transactions,
      createdAt: now,
    });
  }

  getBreakdownContext(userId: string, now = new Date()): ConversationContext | undefined {
    const context = this.contexts.get(userId);

    if (!context) {
      return undefined;
    }

    if (now.getTime() - context.createdAt.getTime() > this.ttlMs) {
      this.contexts.delete(userId);
      return undefined;
    }

    return context;
  }

  isAffirmativeReply(message: string): boolean {
    const normalized = message.trim().toLowerCase();

    if (
      normalized.startsWith('yes') ||
      normalized.startsWith('yeah') ||
      normalized.startsWith('yep') ||
      normalized.startsWith('sure') ||
      normalized.startsWith('ok') ||
      normalized.startsWith('okay')
    ) {
      return true;
    }

    return [
      'yes',
      'y',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'please',
      'show me',
      'breakdown',
    ].includes(normalized);
  }

  isBreakdownRequest(message: string): boolean {
    const normalized = message.trim().toLowerCase();

    return (
      this.isAffirmativeReply(normalized) ||
      normalized.includes('breakdown') ||
      normalized.includes('list') ||
      normalized.includes('transaction') ||
      normalized.includes('details') ||
      normalized.includes('category') ||
      normalized.includes('categories') ||
      normalized.includes('show')
    );
  }

  shouldIncludeCategory(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return normalized.includes('category') || normalized.includes('categories');
  }

  formatBreakdown(
    transactions: Transaction[],
    options?: { includeCategory?: boolean; limit?: number },
  ): string {
    if (transactions.length === 0) {
      return 'I do not have matching transactions to break down yet.';
    }

    const limit = options?.limit ?? 12;
    const lines = transactions.slice(0, limit).map((transaction) => {
      const category = options?.includeCategory ? ` | ${transaction.category}` : '';
      return `- ${transaction.date.toLocaleDateString('en-US')}: ${transaction.merchant}${category} | ${formatCurrency(
        Math.abs(transaction.amount),
      )}`;
    });

    const remainingCount = Math.max(transactions.length - limit, 0);
    const suffix = remainingCount > 0 ? `\n...and ${remainingCount} more.` : '';

    return `Here is the breakdown:\n${lines.join('\n')}${suffix}`;
  }
}
