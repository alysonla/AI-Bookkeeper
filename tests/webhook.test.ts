import { describe, expect, it, vi } from 'vitest';
import { processWebhookPayload } from '../src/api/webhook.js';
import { CalculatorService } from '../src/services/calculator.js';
import type { ConversationService } from '../src/services/conversation.js';
import { IntentService } from '../src/services/intent.js';
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

  it('lists a newly mentioned category from source transactions instead of repeating the last breakdown', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('Here are the March Health transactions.');
    const sourceTransactions = [
      {
        date: new Date(2026, 2, 21),
        merchant: 'Any Hour Services',
        category: 'Home Maintenance',
        amount: -28,
      },
      {
        date: new Date(2026, 2, 22),
        merchant: 'Pharmacy',
        category: 'Health',
        amount: -40,
      },
      {
        date: new Date(2026, 2, 23),
        merchant: 'Doctor',
        category: 'Health',
        amount: -120,
      },
    ];
    const context = {
      transactions: sourceTransactions.slice(0, 1),
      sourceTransactions,
      createdAt: new Date('2026-07-01'),
      lastResult: sourceTransactions.slice(0, 1),
      transactionCount: 1,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(true),
      getBreakdownContext: vi.fn().mockReturnValue(context),
      getContext: vi.fn().mockReturnValue(context),
      summarizeContext: vi.fn(),
      saveCalculationContext: vi.fn(),
      shouldIncludeCategory: vi.fn(),
      formatBreakdown: vi.fn().mockReturnValue('Wrong repeated home maintenance list.'),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-8',
          timestamp: '1770000007',
          text: 'thanks! list out each of the health transactions for march',
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
      question: 'thanks! list out each of the health transactions for march',
      result: [
        {
          date: new Date(2026, 2, 22),
          merchant: 'Pharmacy',
          category: 'Health',
          amount: -40,
        },
        {
          date: new Date(2026, 2, 23),
          merchant: 'Doctor',
          category: 'Health',
          amount: -120,
        },
      ],
      transactionCount: 2,
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'Here are the March Health transactions.',
    );
    expect(extractCalculationPlan).not.toHaveBeenCalled();
    expect(conversationService.formatBreakdown).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('routes context-only total-for-category transaction wording to a sum instead of a list', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('June Health spending was $100.');
    const sourceTransactions = [
      {
        date: new Date(2026, 5, 4),
        merchant: 'Rupa Labs',
        category: 'Health',
        amount: -75,
      },
      {
        date: new Date(2026, 5, 10),
        merchant: 'Prime IV',
        category: 'Health',
        amount: -25,
      },
      {
        date: new Date(2026, 5, 12),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -120,
      },
      {
        date: new Date(2026, 6, 1),
        merchant: 'Doctor',
        category: 'Health',
        amount: -40,
      },
    ];
    const context = {
      transactions: sourceTransactions,
      sourceTransactions,
      createdAt: new Date('2026-07-01'),
      transactionCount: sourceTransactions.length,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
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
          id: 'wamid-10',
          timestamp: '1770000009',
          text: 'whats the total for health transactions?',
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
      question: 'whats the total for health transactions?',
      result: {
        totalSpending: 140,
        signedTotal: -140,
        excludedCategories: ['transfer', 'transfers'],
      },
      transactionCount: 3,
    });
    expect(sendReply).toHaveBeenCalledWith('15551234567', 'June Health spending was $100.');
    expect(extractCalculationPlan).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('reads Sheets for standalone category totals with a date even when context is stale', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>().mockResolvedValue({
      intent: 'unknown',
      dateRange: 'all_time',
    });
    const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>().mockResolvedValue([
      {
        date: new Date(2026, 5, 4),
        merchant: 'Rupa Labs',
        category: 'Health',
        amount: -75,
      },
      {
        date: new Date(2026, 5, 10),
        merchant: 'Prime IV',
        category: 'Health',
        amount: -25,
      },
      {
        date: new Date(2026, 5, 12),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -120,
      },
    ]);
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('June Health spending was $100.');
    const staleContext = {
      transactions: [
        {
          date: new Date(2026, 5, 12),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
      ],
      createdAt: new Date('2026-07-01'),
      transactionCount: 1,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
      getContext: vi.fn().mockReturnValue(staleContext),
      summarizeContext: vi.fn(),
      saveCalculationContext: vi.fn(),
      shouldIncludeCategory: vi.fn(),
      formatBreakdown: vi.fn(),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-11',
          timestamp: '1770000010',
          text: 'whats the total for health transactions in June?',
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
        intentService: new IntentService(new CalculatorService()),
        conversationService: conversationService as unknown as ConversationService,
        planExecutorService: new PlanExecutorService(new CalculatorService()),
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    const expectedResult = {
      operation: 'category_sum',
      totalSpending: 100,
      signedTotal: -100,
      includedCategories: ['Health'],
      categories: [{ category: 'Health', total: -100, count: 2 }],
      excludedCategories: ['transfer', 'transfers'],
    };

    expect(extractCalculationPlan).not.toHaveBeenCalled();
    expect(listTransactions).toHaveBeenCalledOnce();
    expect(generateResponse).toHaveBeenCalledWith({
      question: 'whats the total for health transactions in June?',
      result: expectedResult,
      transactionCount: 2,
    });
    expect(conversationService.saveCalculationContext).toHaveBeenCalledWith('15551234567', {
      question: 'whats the total for health transactions in June?',
      result: expectedResult,
      transactionCount: 2,
      transactions: [
        {
          date: new Date(2026, 5, 4),
          merchant: 'Rupa Labs',
          category: 'Health',
          amount: -75,
        },
        {
          date: new Date(2026, 5, 10),
          merchant: 'Prime IV',
          category: 'Health',
          amount: -25,
        },
      ],
      sourceTransactions: [
        {
          date: new Date(2026, 5, 4),
          merchant: 'Rupa Labs',
          category: 'Health',
          amount: -75,
        },
        {
          date: new Date(2026, 5, 10),
          merchant: 'Prime IV',
          category: 'Health',
          amount: -25,
        },
        {
          date: new Date(2026, 5, 12),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
      ],
    });
    expect(sendReply).toHaveBeenCalledWith('15551234567', 'June Health spending was $100.');
  });

  it('recalculates a prior category total after excluding named merchants', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>();
    const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
    const listTransactions = vi.fn<SheetsService['listTransactions']>();
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('June Health spending without those items was $534.50.');
    const sourceTransactions = [
      {
        date: new Date(2026, 5, 4),
        merchant: 'Rupa Labs Newark De',
        category: 'Health',
        amount: -761,
      },
      {
        date: new Date(2026, 5, 9),
        merchant: 'Prime Iv Hydration Pleasant Grove UT',
        category: 'Health',
        amount: -5,
      },
      {
        date: new Date(2026, 5, 21),
        merchant: 'Prime Iv Hydration Pleasant Grove UT',
        category: 'Health',
        amount: -190.5,
      },
      {
        date: new Date(2026, 5, 22),
        merchant: 'Pharmacy',
        category: 'Health',
        amount: -529.5,
      },
      {
        date: new Date(2026, 5, 23),
        merchant: 'Costco',
        category: 'Groceries',
        amount: -120,
      },
    ];
    const context = {
      transactions: sourceTransactions.filter((transaction) => transaction.category === 'Health'),
      sourceTransactions,
      createdAt: new Date('2026-07-01'),
      transactionCount: 4,
    };
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
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
          id: 'wamid-11',
          timestamp: '1770000010',
          text: 'if you remove Rupa Labs and my monthly subscription from Prime IV, how much would my health spending be?',
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
      question:
        'if you remove Rupa Labs and my monthly subscription from Prime IV, how much would my health spending be?',
      result: {
        totalSpending: 534.5,
        signedTotal: -534.5,
        excludedCategories: ['transfer', 'transfers'],
      },
      transactionCount: 2,
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'June Health spending without those items was $534.50.',
    );
    expect(extractCalculationPlan).not.toHaveBeenCalled();
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('lists standalone category transactions from Sheets when intent extraction is unknown', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>().mockResolvedValue({
      intent: 'unknown',
      dateRange: 'all_time',
    });
    const listTransactions = vi.fn<SheetsService['listTransactions']>().mockResolvedValue([
      {
        date: new Date(2026, 2, 31),
        merchant: 'The Home Depot',
        category: 'Home Maintenance',
        amount: -30.39,
        account: 'Delta SkyMiles Gold Card',
      },
      {
        date: new Date(2026, 2, 30),
        merchant: 'Y.a Home Services',
        category: 'Home Maintenance',
        amount: -698.62,
        account: 'Delta SkyMiles Gold Card',
      },
      {
        date: new Date(2026, 2, 22),
        merchant: 'Pharmacy',
        category: 'Health',
        amount: -40,
      },
      {
        date: new Date(2026, 3, 1),
        merchant: 'Hardware Store',
        category: 'Home Maintenance',
        amount: -25,
      },
    ]);
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('Here are the March Home Maintenance transactions.');
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
      getContext: vi.fn().mockReturnValue(undefined),
      saveCalculationContext: vi.fn(),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-9',
          timestamp: '1770000008',
          text: 'list out each of the home maintenance transactions in March',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: new IntentService(new CalculatorService()),
        conversationService: conversationService as unknown as ConversationService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(generateResponse).toHaveBeenCalledWith({
      question: 'list out each of the home maintenance transactions in March',
      result: [
        {
          date: new Date(2026, 2, 31),
          merchant: 'The Home Depot',
          category: 'Home Maintenance',
          amount: -30.39,
          account: 'Delta SkyMiles Gold Card',
        },
        {
          date: new Date(2026, 2, 30),
          merchant: 'Y.a Home Services',
          category: 'Home Maintenance',
          amount: -698.62,
          account: 'Delta SkyMiles Gold Card',
        },
      ],
      transactionCount: 2,
    });
    expect(conversationService.saveCalculationContext).toHaveBeenCalledWith('15551234567', {
      question: 'list out each of the home maintenance transactions in March',
      result: [
        {
          date: new Date(2026, 2, 31),
          merchant: 'The Home Depot',
          category: 'Home Maintenance',
          amount: -30.39,
          account: 'Delta SkyMiles Gold Card',
        },
        {
          date: new Date(2026, 2, 30),
          merchant: 'Y.a Home Services',
          category: 'Home Maintenance',
          amount: -698.62,
          account: 'Delta SkyMiles Gold Card',
        },
      ],
      transactionCount: 2,
      transactions: [
        {
          date: new Date(2026, 2, 31),
          merchant: 'The Home Depot',
          category: 'Home Maintenance',
          amount: -30.39,
          account: 'Delta SkyMiles Gold Card',
        },
        {
          date: new Date(2026, 2, 30),
          merchant: 'Y.a Home Services',
          category: 'Home Maintenance',
          amount: -698.62,
          account: 'Delta SkyMiles Gold Card',
        },
      ],
      sourceTransactions: [
        {
          date: new Date(2026, 2, 31),
          merchant: 'The Home Depot',
          category: 'Home Maintenance',
          amount: -30.39,
          account: 'Delta SkyMiles Gold Card',
        },
        {
          date: new Date(2026, 2, 30),
          merchant: 'Y.a Home Services',
          category: 'Home Maintenance',
          amount: -698.62,
          account: 'Delta SkyMiles Gold Card',
        },
        {
          date: new Date(2026, 2, 22),
          merchant: 'Pharmacy',
          category: 'Health',
          amount: -40,
        },
      ],
    });
    expect(sendReply).toHaveBeenCalledWith(
      '15551234567',
      'Here are the March Home Maintenance transactions.',
    );
  });

  it('does not save empty unknown calculations over useful conversation context', async () => {
    const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
    const extractIntent = vi.fn<OpenAIService['extractIntent']>().mockResolvedValue({
      intent: 'unknown',
      dateRange: 'all_time',
    });
    const listTransactions = vi.fn<SheetsService['listTransactions']>().mockResolvedValue([]);
    const generateResponse = vi
      .fn<OpenAIService['generateResponse']>()
      .mockResolvedValue('You are very welcome.');
    const conversationService = {
      isBreakdownRequest: vi.fn().mockReturnValue(false),
      getBreakdownContext: vi.fn().mockReturnValue(undefined),
      getContext: vi.fn().mockReturnValue(undefined),
      saveCalculationContext: vi.fn(),
    };

    const whatsappService = {
      parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
        {
          from: '15551234567',
          id: 'wamid-10',
          timestamp: '1770000009',
          text: 'thanks penny, you are great!',
        },
      ]),
      sendReply,
    } as unknown as WhatsAppService;

    await processWebhookPayload(
      {
        whatsappService,
        openAIService: {
          extractIntent,
          generateResponse,
          generateSmartReply: vi.fn<OpenAIService['generateSmartReply']>(),
        } as unknown as OpenAIService,
        sheetsService: {
          listTransactions,
        } as unknown as SheetsService,
        intentService: new IntentService(new CalculatorService()),
        conversationService: conversationService as unknown as ConversationService,
        logger,
        whatsappSmokeTest: false,
        whatsappSmartReplies: false,
      },
      { object: 'whatsapp_business_account' },
    );

    expect(generateResponse).toHaveBeenCalledWith({
      question: 'thanks penny, you are great!',
      result: {
        message: 'I could not determine which bookkeeping calculation to run.',
      },
      transactionCount: 0,
    });
    expect(conversationService.saveCalculationContext).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith('15551234567', 'You are very welcome.');
  });

  it('reads Sheets for category totals when the saved context has no transactions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));

    try {
      const sendReply = vi.fn<WhatsAppService['sendReply']>().mockResolvedValue(undefined);
      const extractIntent = vi.fn<OpenAIService['extractIntent']>().mockResolvedValue({
        intent: 'category_totals',
        dateRange: 'all_time',
      });
      const extractCalculationPlan = vi.fn<OpenAIService['extractCalculationPlan']>();
      const listTransactions = vi.fn<SheetsService['listTransactions']>().mockResolvedValue([
        {
          date: new Date(2026, 5, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
        {
          date: new Date(2026, 5, 6),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -40,
        },
        {
          date: new Date(2026, 5, 7),
          merchant: 'Transfer',
          category: 'Transfer',
          amount: -999,
        },
        {
          date: new Date(2026, 4, 1),
          merchant: 'Vet',
          category: 'Milo',
          amount: -500,
        },
      ]);
      const generateResponse = vi
        .fn<OpenAIService['generateResponse']>()
        .mockResolvedValue('Last month category totals are ready.');
      const conversationService = {
        isBreakdownRequest: vi.fn().mockReturnValue(false),
        getBreakdownContext: vi.fn().mockReturnValue(undefined),
        getContext: vi.fn().mockReturnValue({
          transactions: [],
          sourceTransactions: [],
          createdAt: new Date('2026-07-20T11:55:00Z'),
          lastQuestion: 'thanks penny, you are great!',
          lastResult: {
            message: 'I could not determine which bookkeeping calculation to run.',
          },
          transactionCount: 0,
        }),
        summarizeContext: vi.fn(),
        saveCalculationContext: vi.fn(),
      };

      const whatsappService = {
        parseIncomingMessages: vi.fn<WhatsAppService['parseIncomingMessages']>().mockReturnValue([
          {
            from: '15551234567',
            id: 'wamid-11',
            timestamp: '1770000010',
            text: 'how much did I spend last month - list out all the categories..',
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
          intentService: new IntentService(new CalculatorService()),
          conversationService: conversationService as unknown as ConversationService,
          planExecutorService: new PlanExecutorService(new CalculatorService()),
          logger,
          whatsappSmokeTest: false,
          whatsappSmartReplies: false,
        },
        { object: 'whatsapp_business_account' },
      );

      const expectedTransactions = [
        {
          date: new Date(2026, 5, 5),
          merchant: 'Costco',
          category: 'Groceries',
          amount: -120,
        },
        {
          date: new Date(2026, 5, 6),
          merchant: 'Cafe',
          category: 'Eating Out',
          amount: -40,
        },
      ];
      const expectedResult = {
        operation: 'category_totals',
        categories: [
          { category: 'Groceries', total: -120, count: 1 },
          { category: 'Eating Out', total: -40, count: 1 },
        ],
        excludedCategories: ['transfer', 'transfers'],
      };

      expect(extractCalculationPlan).not.toHaveBeenCalled();
      expect(listTransactions).toHaveBeenCalledOnce();
      expect(generateResponse).toHaveBeenCalledWith({
        question: 'how much did I spend last month - list out all the categories..',
        result: expectedResult,
        transactionCount: 2,
      });
      expect(conversationService.saveCalculationContext).toHaveBeenCalledWith('15551234567', {
        question: 'how much did I spend last month - list out all the categories..',
        result: expectedResult,
        transactionCount: 2,
        transactions: expectedTransactions,
        sourceTransactions: expectedTransactions,
      });
      expect(sendReply).toHaveBeenCalledWith(
        '15551234567',
        'Last month category totals are ready.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
