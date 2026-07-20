import { describe, expect, it, vi } from 'vitest';
import { processWebhookPayload } from '../src/api/webhook.js';
import type { ConversationService } from '../src/services/conversation.js';
import type { IntentService } from '../src/services/intent.js';
import type { OpenAIService } from '../src/services/openai.js';
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
});
