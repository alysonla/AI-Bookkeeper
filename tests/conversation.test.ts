import { describe, expect, it } from 'vitest';
import { ConversationService } from '../src/services/conversation.js';

describe('ConversationService', () => {
  it('stores and expires breakdown contexts', () => {
    const service = new ConversationService(1000);
    const transactions = [
      {
        date: new Date('2026-07-01'),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -42,
      },
    ];

    service.saveBreakdownContext('user-1', transactions, new Date('2026-07-01T00:00:00Z'));

    expect(service.getBreakdownContext('user-1', new Date('2026-07-01T00:00:00Z'))).toEqual({
      transactions,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(service.getBreakdownContext('user-1', new Date('2026-07-01T00:00:02Z'))).toBeUndefined();
  });

  it('formats deterministic transaction breakdowns', () => {
    const service = new ConversationService();

    expect(
      service.formatBreakdown([
        {
          date: new Date('2026-07-01'),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -42,
        },
      ]),
    ).toContain('Costco | $42.00');
  });

  it('stores calculation context for follow-up planning', () => {
    const service = new ConversationService();
    const transactions = [
      {
        date: new Date('2026-07-01'),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -42,
      },
    ];

    service.saveCalculationContext('user-1', {
      question: 'what did I spend?',
      result: -42,
      transactionCount: 1,
      transactions,
    });

    const context = service.getContext('user-1');

    expect(context?.lastQuestion).toBe('what did I spend?');
    expect(context?.lastNumericResult).toBe(-42);
    expect(context?.transactionCount).toBe(1);
    expect(service.summarizeContext(context!)).toMatchObject({
      lastQuestion: 'what did I spend?',
      lastNumericResult: -42,
      transactionCount: 1,
      availableTransactionCount: 1,
    });
  });

  it('includes categories in breakdowns when requested', () => {
    const service = new ConversationService();

    expect(
      service.formatBreakdown(
        [
          {
            date: new Date('2026-07-01'),
            merchant: 'Costco',
            category: 'Groceries',
            amount: -42,
          },
        ],
        { includeCategory: true },
      ),
    ).toContain('Costco | Groceries | $42.00');
  });

  it('detects natural breakdown follow-up requests', () => {
    const service = new ConversationService();

    expect(service.isBreakdownRequest('Yes please')).toBe(true);
    expect(service.isBreakdownRequest('Ok list out each transaction')).toBe(true);
    expect(service.isBreakdownRequest('Include the category for each')).toBe(true);
    expect(service.isBreakdownRequest('show me the details')).toBe(true);
    expect(service.isBreakdownRequest('what is my net income?')).toBe(false);
  });

  it('detects category detail requests', () => {
    const service = new ConversationService();

    expect(service.shouldIncludeCategory('Include the category for each')).toBe(true);
    expect(service.shouldIncludeCategory('show me details')).toBe(false);
  });
});
