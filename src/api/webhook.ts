import { Router } from 'express';
import type { ConversationService } from '../services/conversation.js';
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
  conversationService?: ConversationService;
  logger: Logger;
  whatsappSmokeTest: boolean;
  whatsappSmartReplies: boolean;
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
      const startedAt = Date.now();

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

        if (dependencies.whatsappSmartReplies) {
          dependencies.logger.info('Processing WhatsApp smart-reply message.', {
            messageId: message.id,
          });
          const reply = await dependencies.openAIService.generateSmartReply(message.text);
          await dependencies.whatsappService.sendReply(message.from, reply);
          return;
        }

        if (
          dependencies.conversationService?.isBreakdownRequest(message.text) &&
          dependencies.conversationService.getBreakdownContext(message.from)
        ) {
          dependencies.logger.info('Processing WhatsApp breakdown follow-up message.', {
            messageId: message.id,
          });
          const context = dependencies.conversationService.getBreakdownContext(message.from);
          const reply = dependencies.conversationService.formatBreakdown(
            context?.transactions ?? [],
            {
              includeCategory: dependencies.conversationService.shouldIncludeCategory(message.text),
            },
          );
          await dependencies.whatsappService.sendReply(message.from, reply);
          return;
        }

        const intent = await dependencies.openAIService.extractIntent(message.text);
        const transactions = await dependencies.sheetsService.listTransactions();
        const calculation = dependencies.intentService.processIntent(intent, transactions);
        dependencies.conversationService?.saveBreakdownContext(
          message.from,
          calculation.transactions,
        );
        const reply = await dependencies.openAIService.generateResponse({
          question: message.text,
          result: calculation.result,
          transactionCount: calculation.transactionCount,
        });

        await dependencies.whatsappService.sendReply(message.from, reply);
        dependencies.logger.info('Processed WhatsApp bookkeeping message.', {
          messageId: message.id,
          durationMs: Date.now() - startedAt,
        });
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
