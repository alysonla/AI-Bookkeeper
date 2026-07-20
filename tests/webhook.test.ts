import { describe, expect, it, vi } from 'vitest';
import { processWebhookPayload } from '../src/api/webhook.js';
import { CalculatorService } from '../src/services/calculator.js';
import type { ConversationService } from '../src/services/conversation.js';
import type { IntentService } from '../src/services/intent.js';
import type { OpenAIService } from '../src/services/openai.js';
import { PlanExecutorService } from '../src/services/planExecutor.js';
import type { SheetsService } from '../src/services/sheets.js';
import type { WhatsAppService } from '../src/services/whatsapp.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('processWebhookPayload', () => {
  it('replies in smoke-test mode without calling OpenAI or Sheets', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-1',
          timestamp: '1770000000',
          text: 'ping',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    const openAIService = {
      extractIntent,
      generateResponse: vi.fn<OpenAIService['generateResponse']>(),
    } as unknown as OpenAIService;

    const sheetsService = {
      listTransactions,
    } as unknown as SheetsService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService,
        sheetsService,
        intentService: {} as IntentService,
        logger,
        whatsappSmokeTest: true,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(sendReply).toHaveBeenCalledWith('15551234567', 'Penny received: ping');
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('uses OpenAI smart replies without calling Sheets', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const generateSmartReply = vi
      .fn<OpenAIService['generateSmartReply']>()
      .mockResolvedValue('Hi, I am Penny. I can hear you.');
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-2',
          timestamp: '1770000001',
          text: 'hello',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    const openAIService = {
      extractIntent,
      generateResponse: vi.fn<OpenAIService['generateResponse']>(),
      generateSmartReply,
    } as unknown as OpenAIService;

    const sheetsService = {
      listTransactions,
    } as unknown as SheetsService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService,
        sheetsService,
        intentService: {} as IntentService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: true,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(generateSmartReply).toHaveBeenCalledWith('hello');
    expect(sendReply).toHaveBeenCalledWith('15551234567', 'Hi, I am Penny. I can hear you.');
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('uses the last calculation context for yes-style breakdown follow-ups', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(true),
      shouldIncludeCategory: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue({
        transactions: [
          {
            date: new Date('2026-07-01'),
            merchant: 'Costco',
            category: 'Groceries',
            amount: -42,
          },
        ],
      }),
      formatBreakdown: vi.fn().mockReturnValue('Here is the breakdown.'),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-3',
          timestamp: '1770000002',
          text: 'yes',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          generateResponse: vi.fn<OpenAIService['generateResponse']>(),
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: {} as IntentService,
        conversationService: conversationService as unknown as ConversationService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(sendReply).toHaveBeenCalledWith('15551234567', 'Here is the breakdown.');
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('executes calculation-plan follow-ups from saved context without reading Sheets', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const extractCalculationPlan = vi
      .fn<OpenAIService['extractCalculationPlan']>()
      .mockResolvedValue({
        source: 'previous_result',
        operation: 'average',
        metric: 'expenses',
        divisor: 6,
        approximate: true,
      });
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('Yep, that is about $8,191.62 per month.');
    const context = {
      transactions: [
        {
          date: new Date('2026-01-01'),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -42,
        },
      ],
      createdAt: new Date('2026-07-01'),
      lastNumericResult: -49149.74,
      transactionCount: 665,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
      getContext: vi.fn().mockReturnValue(context),
      summarizeContext: vi.fn().mockReturnValue({
        lastNumericResult: -49149.74,
        transactionCount: 665,
      }),
      saveCalculationContext: vi.fn(),
    };
    const planExecutorService = {
      execute: vi.fn<PlanExecutorService['execute']>().mockReturnValue({
        result: {
          value: 8191.62,
          operation: 'average',
          divisor: 6,
          sourceValue: 49149.74,
          approximate: true,
        },
        transactionCount: 1,
        transactions: context.transactions,
      }),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-4',
          timestamp: '1770000003',
          text: 'so thats like $8k on average each month yeah?',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          extractCalculationPlan,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: {} as IntentService,
        conversationService: conversationService as unknown as ConversationService,
        planExecutorService: planExecutorService as unknown as PlanExecutorService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(extractCalculationPlan).toHaveBeenCalledWith(
      'so thats like $8k on average each month yeah?',
      {
        lastNumericResult: -49149.74,
        transactionCount: 665,
      },
    );
    expect(generateResponse).toHaveBeenCalledWith({
      question: 'so thats like $8k on average each month yeah?',
      result: {
        value: 8191.62,
        operation: 'average',
        divisor: 6,
        sourceValue: 49149.74,
        approximate: true,
      },
      transactionCount: 1,
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'Yep, that is about $8,191.62 per month.',
    );
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('lets calculation plans handle affirmative follow-ups before transaction breakdowns', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const extractCalculationPlan = vi
      .fn<OpenAIService['extractCalculationPlan']>()
      .mockResolvedValue({
        source: 'previous_result',
        operation: 'median',
        metric: 'expenses',
      });
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('Your median monthly spending was $7,802.34.');
    const context = {
      transactions: [
        {
          date: new Date('2026-06-01'),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -42,
        },
      ],
      createdAt: new Date('2026-07-01'),
      lastResult: {
        monthlyExpenses: [
          { month: '2026-01', expenses: 7747.55 },
          { month: '2026-02', expenses: 5289.81 },
          { month: '2026-03', expenses: 14220.5 },
          { month: '2026-04', expenses: 7866.1 },
          { month: '2026-05', expenses: 7857.12 },
          { month: '2026-06', expenses: 6168.66 },
        ],
      },
      transactionCount: 665,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(true),
      getBreakdownContext: vi.fn().mockReturnValue(context),
      getContext: vi.fn().mockReturnValue(context),
      summarizeContext: vi.fn().mockReturnValue({
        lastResult: context.lastResult,
        transactionCount: 665,
      }),
      saveCalculationContext: vi.fn(),
      shouldIncludeCategory: vi.fn(),
      formatBreakdown: vi.fn().mockReturnValue('Here is the breakdown.'),
    };
    const planExecutorService = {
      execute: vi.fn<PlanExecutorService['execute']>().mockReturnValue({
        result: {
          medianMonthlySpending: 7802.34,
          totalSpending: 49149.74,
          monthCount: 6,
        },
        transactionCount: 665,
        transactions: context.transactions,
      }),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-5',
          timestamp: '1770000004',
          text: 'yes',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          extractCalculationPlan,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: {} as IntentService,
        conversationService: conversationService as unknown as ConversationService,
        planExecutorService: planExecutorService as unknown as PlanExecutorService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'Your median monthly spending was $7,802.34.',
    );
    expect(conversationService.formatBreakdown).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('answers observational follow-ups from the previous result without reading Sheets', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const extractCalculationPlan = vi
      .fn<OpenAIService['extractCalculationPlan']>()
      .mockResolvedValue({
        source: 'previous_result',
        operation: 'answer_from_previous_result',
      });
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('Yes, those categories were the main March drivers.');
    const context = {
      transactions: [
        {
          date: new Date('2026-03-01'),
          merchant: 'Vet',
          category: 'Milo',
          amount: -3624.55,
        },
      ],
      createdAt: new Date('2026-07-01'),
      lastQuestion: 'list out the total for all categories for the month of march',
      lastResult: [
        { category: 'Milo', total: -3624.55, count: 2 },
        { category: 'Groceries', total: -1549.98, count: 24 },
        { category: 'Home Maintenance', total: -1440.01, count: 10 },
      ],
      transactionCount: 120,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
      getContext: vi.fn().mockReturnValue(context),
      summarizeContext: vi.fn().mockReturnValue({
        lastQuestion: context.lastQuestion,
        lastResult: context.lastResult,
        transactionCount: 120,
      }),
      saveCalculationContext: vi.fn(),
    };
    const planExecutorService = {
      execute: vi.fn<PlanExecutorService['execute']>().mockReturnValue({
        result: {
          previousQuestion: context.lastQuestion,
          previousResult: context.lastResult,
        },
        transactionCount: 120,
        transactions: context.transactions,
      }),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-6',
          timestamp: '1770000005',
          text: 'thanks, so Milo and Home Maintenance were the outliers',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          extractCalculationPlan,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: {} as IntentService,
        conversationService: conversationService as unknown as ConversationService,
        planExecutorService: planExecutorService as unknown as PlanExecutorService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(generateResponse).toHaveBeenCalledWith({
      question: 'thanks, so Milo and Home Maintenance were the outliers',
      result: {
        previousQuestion: context.lastQuestion,
        previousResult: context.lastResult,
      },
      transactionCount: 120,
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'Yes, those categories were the main March drivers.',
    );
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('forces category follow-ups through March-scoped previous transactions', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('March categories are grouped correctly.');
    const sourceTransactions = [
      {
        date: new Date(2026, 0, 1),
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
        date: new Date(2026, 2, 20),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -1549.98,
      },
      {
        date: new Date(2026, 3, 1),
        merchant: 'Cafe',
        category: 'Eating Out',
        amount: -75,
      },
    ];
    const context = {
      transactions: sourceTransactions.slice(1, 3),
      sourceTransactions,
      createdAt: new Date('2026-07-01'),
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
      transactionCount: 665,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(true),
      getBreakdownContext: vi.fn().mockReturnValue(context),
      getContext: vi.fn().mockReturnValue(context),
      summarizeContext: vi.fn(),
      saveCalculationContext: vi.fn(),
      shouldIncludeCategory: vi.fn(),
      formatBreakdown: vi.fn(),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-7',
          timestamp: '1770000006',
          text: 'what happened in March? can you list out each of the categories',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          extractCalculationPlan,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: {} as IntentService,
        conversationService: conversationService as unknown as ConversationService,
        planExecutorService: new PlanExecutorService(new CalculatorService()),
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(generateResponse).toHaveBeenCalledWith({
      question: 'what happened in March? can you list out each of the categories',
      result: [
        { category: 'Milo', total: -3624.55, count: 1 },
        { category: 'Groceries', total: -1549.98, count: 1 },
        { category: 'Home Maintenance', total: -1440.01, count: 1 },
      ],
      transactionCount: 3,
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'March categories are grouped correctly.',
    );
    expect(extractCalculationPlan).not.toHaveBeenCalled();
    expect(conversationService.formatBreakdown).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });
});
