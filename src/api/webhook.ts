import { Router } from 'express';
import type { ConversationService } from '../services/conversation.js';
import type { IntentService } from '../services/intent.js';
import type { OpenAIService } from '../services/openai.js';
import type { PlanExecutorService } from '../services/planExecutor.js';
import type { SheetsService } from '../services/sheets.js';
import type { WhatsAppService } from '../services/whatsapp.js';
import type { CalculationPlan } from '../types/calculationPlan.js';
import type { WhatsAppWebhookPayload } from '../types/whatsapp.js';
import { normalizeCategory } from '../utils/categories.js';
import type { Logger } from '../utils/logger.js';

export interface WebhookRouterDependencies {
  whatsappService: WhatsAppService;
  openAIService: OpenAIService;
  sheetsService: SheetsService;
  intentService: IntentService;
  conversationService?: ConversationService;
  planExecutorService?: PlanExecutorService;
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

        const plannedResult = await tryProcessCalculationPlan(
          dependencies,
          message.from,
          message.text,
        );

        if (plannedResult) {
          const reply = await dependencies.openAIService.generateResponse({
            question: message.text,
            result: plannedResult.result,
            transactionCount: plannedResult.transactionCount,
          });

          dependencies.conversationService?.saveCalculationContext(message.from, {
            question: message.text,
            result: plannedResult.result,
            transactionCount: plannedResult.transactionCount,
            transactions: plannedResult.transactions,
            sourceTransactions: plannedResult.sourceTransactions,
          });

          await dependencies.whatsappService.sendReply(message.from, reply);
          dependencies.logger.info('Processed WhatsApp calculation-plan follow-up message.', {
            messageId: message.id,
            durationMs: Date.now() - startedAt,
          });
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
        const calculation = dependencies.intentService.processIntent(
          intent,
          transactions,
          new Date(),
          message.text,
        );
        dependencies.conversationService?.saveCalculationContext(message.from, {
          question: message.text,
          result: calculation.result,
          transactionCount: calculation.transactionCount,
          transactions: calculation.transactions,
          sourceTransactions: calculation.sourceTransactions ?? calculation.transactions,
        });
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

async function tryProcessCalculationPlan(
  dependencies: WebhookRouterDependencies,
  userId: string,
  messageText: string,
) {
  if (!dependencies.planExecutorService || !dependencies.conversationService) {
    return undefined;
  }

  const context = dependencies.conversationService.getContext(userId);

  if (!context) {
    return undefined;
  }

  try {
    const plan =
      createDeterministicFollowUpPlan(messageText, context) ??
      (await dependencies.openAIService.extractCalculationPlan(
        messageText,
        dependencies.conversationService.summarizeContext(context),
      ));
    const result = dependencies.planExecutorService.execute(plan, context, messageText);

    if (!result) {
      return undefined;
    }

    dependencies.logger.info('Executed calculation plan from conversation context.', {
      operation: plan.operation,
      source: plan.source,
    });

    return result;
  } catch (error) {
    dependencies.logger.warn('Could not execute calculation plan from conversation context.', {
      error: error instanceof Error ? error.message : String(error),
    });

    return undefined;
  }
}

function createDeterministicFollowUpPlan(
  messageText: string,
  context: {
    transactions: Array<{ category: string }>;
    sourceTransactions?: Array<{ category: string }>;
  },
): CalculationPlan | undefined {
  const normalizedText = messageText.toLowerCase();
  const mentionedCategory = findMentionedCategory(messageText, [
    ...(context.sourceTransactions ?? []),
    ...context.transactions,
  ]);

  if (mentionedCategory && /\b(?:list|show|transactions?|details?)\b/.test(normalizedText)) {
    return {
      source: 'previous_transactions',
      operation: 'list',
      metric: 'expenses',
      filters: {
        category: mentionedCategory,
      },
    };
  }

  if (!/\bcategor(?:y|ies)\b/.test(normalizedText)) {
    return undefined;
  }

  return {
    source: 'previous_transactions',
    operation: 'group_by',
    groupBy: 'category',
    metric: 'expenses',
  };
}

function findMentionedCategory(
  messageText: string,
  transactions: Array<{ category: string }>,
): string | undefined {
  const normalizedText = normalizeCategory(messageText);
  const categories = [...new Set(transactions.map((transaction) => transaction.category))].sort(
    (left, right) => right.length - left.length,
  );

  return categories.find((category) => {
    const normalizedCategory = normalizeCategory(category);

    return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedCategory)}(?:\\s|$)`).test(normalizedText);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
