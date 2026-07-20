import type { Logger } from '../utils/logger.js';
import type { IncomingWhatsAppMessage, WhatsAppWebhookPayload } from '../types/whatsapp.js';

export interface WhatsAppServiceOptions {
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  logger: Logger;
  fetchClient?: typeof fetch;
  retryDelayMs?: number;
}

export class WhatsAppService {
  private readonly fetchClient: typeof fetch;

  constructor(private readonly options: WhatsAppServiceOptions) {
    this.fetchClient = options.fetchClient ?? fetch;
  }

  /** Verifies Meta webhook subscription requests. */
  verifyWebhook(mode: unknown, token: unknown, challenge: unknown): string | null {
    if (
      mode === 'subscribe' &&
      token === this.options.verifyToken &&
      typeof challenge === 'string'
    ) {
      return challenge;
    }

    return null;
  }

  /** Extracts supported inbound text messages from a Meta webhook payload. */
  parseIncomingMessages(payload: WhatsAppWebhookPayload): IncomingWhatsAppMessage[] {
    const messages: IncomingWhatsAppMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== 'text' || !message.from || !message.id || !message.text?.body) {
            continue;
          }

          messages.push({
            from: message.from,
            id: message.id,
            timestamp: message.timestamp ?? '',
            text: message.text.body,
          });
        }
      }
    }

    return messages;
  }

  /** Sends a WhatsApp text reply through the Meta WhatsApp Cloud API. */
  async sendReply(to: string, message: string): Promise<void> {
    const url = `https://graph.facebook.com/v20.0/${this.options.phoneNumberId}/messages`;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetchClient(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body: message,
          },
        }),
      });

      if (response.ok) {
        return;
      }

      const errorBody = await response.text();
      const transient = isTransientMetaError(errorBody);

      if (transient && attempt < maxAttempts) {
        this.options.logger.warn('Transient WhatsApp send failure. Retrying.', {
          status: response.status,
          attempt,
          maxAttempts,
          errorBody,
        });
        await wait(this.options.retryDelayMs ?? 500 * attempt);
        continue;
      }

      this.options.logger.error('Failed to send WhatsApp reply.', {
        status: response.status,
        attempt,
        errorBody,
      });
      throw new Error(`Failed to send WhatsApp reply. Status: ${response.status}`);
    }
  }
}

function isTransientMetaError(errorBody: string): boolean {
  try {
    const parsed = JSON.parse(errorBody) as { error?: { is_transient?: boolean } };
    return parsed.error?.is_transient === true;
  } catch {
    return false;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
