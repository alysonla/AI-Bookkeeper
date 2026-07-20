import { describe, expect, it, vi } from 'vitest';
import { WhatsAppService } from '../src/services/whatsapp.js';
import type { WhatsAppWebhookPayload } from '../src/types/whatsapp.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('WhatsAppService', () => {
  const service = new WhatsAppService({
    verifyToken: 'local-secret',
    accessToken: 'meta-token',
    phoneNumberId: 'phone-id',
    logger,
  });

  it('verifies webhook challenges when the token matches', () => {
    expect(service.verifyWebhook('subscribe', 'local-secret', 'challenge-value')).toBe(
      'challenge-value',
    );
  });

  it('rejects webhook verification when the token does not match', () => {
    expect(service.verifyWebhook('subscribe', 'wrong-token', 'challenge-value')).toBeNull();
  });

  it('parses inbound WhatsApp text messages', () => {
    const payload: WhatsAppWebhookPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid-1',
                    timestamp: '1770000000',
                    type: 'text',
                    text: {
                      body: 'hello Penny',
                    },
                  },
                  {
                    from: '15551234567',
                    id: 'wamid-2',
                    timestamp: '1770000001',
                    type: 'image',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(service.parseIncomingMessages(payload)).toEqual([
      {
        from: '15551234567',
        id: 'wamid-1',
        timestamp: '1770000000',
        text: 'hello Penny',
      },
    ]);
  });
});
