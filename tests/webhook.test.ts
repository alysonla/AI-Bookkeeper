import { describe, expect, it, vi } from 'vitest';
import { processWebhookPayload } from '../src/api/webhook.js';
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
      },
      { object: 'whatsapp_business_account' },
    );

    expect(sendReply).toHaveBeenCalledWith('15551234567', 'Penny received: ping');
    expect(extractIntent).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
  });
});
