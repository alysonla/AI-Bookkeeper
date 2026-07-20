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
}

export function createWebhookRouter(dependencies: WebhookRouterDependencies): Router {
  const router = Router();

  router.post('/webhook', async (req, res) => {
    const payload = req.body as WhatsAppWebhookPayload;
    const messages = dependencies.whatsappService.parseIncomingMessages(payload);

    res.sendStatus(200);

    await Promise.all(
      messages.map(async (message) => {
        try {
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

          await dependencies.whatsappService.sendReply(
            message.from,
            'Sorry, I had trouble answering that bookkeeping question. Please try again in a moment.',
          );
        }
      }),
    );
  });

  return router;
}
