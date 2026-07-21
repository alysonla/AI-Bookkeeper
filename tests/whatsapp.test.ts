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

  it('retries transient Meta send failures', async () => {
    const fetchClient = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: '(#2) Service temporarily unavailable',
              is_transient: true,
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const retryingService = new WhatsAppService({
      verifyToken: 'local-secret',
      accessToken: 'meta-token',
      phoneNumberId: 'phone-id',
      logger,
      fetchClient,
      retryDelayMs: 0,
    });

    await expect(retryingService.sendReply('15551234567', 'hello')).resolves.toBeUndefined();

    expect(fetchClient).toHaveBeenCalledTimes(2);
  });

  it('sends the WhatsApp typing indicator and read receipt payload', async () => {
    const fetchClient = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const typingService = new WhatsAppService({
      verifyToken: 'local-secret',
      accessToken: 'meta-token',
      phoneNumberId: 'phone-id',
      logger,
      fetchClient,
    });

    await expect(typingService.showTypingIndicator('wamid-typing')).resolves.toBeUndefined();

    expect(fetchClient).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/phone-id/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer meta-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid-typing',
        typing_indicator: {
          type: 'text',
        },
      }),
    });
  });

  it('throws when the WhatsApp typing indicator request fails', async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Authentication Error',
          },
        }),
        { status: 401 },
      ),
    );
    const typingService = new WhatsAppService({
      verifyToken: 'local-secret',
      accessToken: 'meta-token',
      phoneNumberId: 'phone-id',
      logger,
      fetchClient,
    });

    await expect(typingService.showTypingIndicator('wamid-typing')).rejects.toThrow(
      'Failed to show WhatsApp typing indicator. Status: 401',
    );
  });

  it('does not retry permanent Meta send failures', async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Authentication Error',
            is_transient: false,
          },
        }),
        { status: 401 },
      ),
    );
    const retryingService = new WhatsAppService({
      verifyToken: 'local-secret',
      accessToken: 'meta-token',
      phoneNumberId: 'phone-id',
      logger,
      fetchClient,
      retryDelayMs: 0,
    });

    await expect(retryingService.sendReply('15551234567', 'hello')).rejects.toThrow(
      'Failed to send WhatsApp reply. Status: 401',
    );

    expect(fetchClient).toHaveBeenCalledTimes(1);
  });
});
