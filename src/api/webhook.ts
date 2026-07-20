import { Router } from 'express';
import type { IntentService } from '../services/intent.js';
import type { OpenAIService } from '../services/openai.js';
import type { SheetsService } from '../services/sheets.js';
import type { WhatsAppService } from '../services/whatsapp.js';
import type { WhatsAppWebhookPayload } from '../types/whatsapp.js';
import type { Logger } from '../utils/logger.js';

export interface WebhookRouterDependencies {
  whatsappService: WhatsAppService;
  openAIService: OpenAIService;
  sheetsService: SheetsService;
  intentService: IntentService;
  logger: Logger;
  whatsappSmokeTest: boolean;
}

export function createWebhookRouter(dependencies: WebhookRouterDependencies): Router {
  const router = Router();

  router.post('/webhook', async (req, res) => {
    const payload = req.body as WhatsAppWebhookPayload;

    dependencies.logger.info('Received WhatsApp webhook request.', {
      object: payload.object,
      entryCount: payload.entry?.length ?? 0,
    });

    res.sendStatus(200);

    await processWebhookPayload(dependencies, payload);
  });

  return router;
}

export async function processWebhookPayload(
  dependencies: WebhookRouterDependencies,
  payload: WhatsAppWebhookPayload,
): Promise<void> {
  const messages = dependencies.whatsappService.parseIncomingMessages(payload);

  dependencies.logger.info('Parsed WhatsApp webhook messages.', {
    messageCount: messages.length,
  });

  await Promise.all(
    messages.map(async (message) => {
      try {
        if (dependencies.whatsappSmokeTest) {
          dependencies.logger.info('Processing WhatsApp smoke-test message.', {
            messageId: message.id,
          });
          await dependencies.whatsappService.sendReply(
            message.from,
            `Penny received: ${message.text}`,
          );
          return;
        }

        const intent = await dependencies.openAIService.extractIntent(message.text);
        const transactions = await dependencies.sheetsService.listTransactions();
        const calculation = dependencies.intentService.processIntent(intent, transactions);
        const reply = await dependencies.openAIService.generateResponse({
          question: message.text,
          result: calculation.result,
          transactionCount: calculation.transactionCount,
        });

        await dependencies.whatsappService.sendReply(message.from, reply);
      } catch (error) {
        dependencies.logger.error('Failed to process incoming WhatsApp message.', {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });

        await sendReplySafely(
          dependencies,
          message.from,
          'Sorry, I had trouble answering that bookkeeping question. Please try again in a moment.',
          message.id,
        );
      }
    }),
  );
}

async function sendReplySafely(
  dependencies: WebhookRouterDependencies,
  to: string,
  reply: string,
  messageId: string,
): Promise<void> {
  try {
    await dependencies.whatsappService.sendReply(to, reply);
  } catch (error) {
    dependencies.logger.error('Failed to send WhatsApp fallback reply.', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
