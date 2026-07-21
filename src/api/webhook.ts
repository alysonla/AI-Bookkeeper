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
        await showTypingIndicatorSafely(dependencies, message.id);

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
        if (shouldSaveCalculationContext(intent.intent, calculation.transactionCount)) {
          dependencies.conversationService?.saveCalculationContext(message.from, {
            question: message.text,
            result: calculation.result,
            transactionCount: calculation.transactionCount,
            transactions: calculation.transactions,
            sourceTransactions: calculation.sourceTransactions ?? calculation.transactions,
          });
        }
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

  if (shouldReadSheetsForStandaloneQuestion(messageText)) {
    return undefined;
  }

  const context = dependencies.conversationService.getContext(userId);
  const availableTransactions = context ? (context.sourceTransactions ?? context.transactions) : [];

  if (!context || availableTransactions.length === 0) {
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

function shouldSaveCalculationContext(intent: string, transactionCount: number): boolean {
  return intent !== 'unknown' || transactionCount > 0;
}

function shouldReadSheetsForStandaloneQuestion(messageText: string): boolean {
  const normalizedText = messageText.toLowerCase();

  if (isContextDependentQuestion(normalizedText)) {
    return false;
  }

  return (
    hasDatePeriod(normalizedText) &&
    isTotalQuestion(normalizedText) &&
    /\b[a-z][a-z\s/&'-]*\s+transactions?\b/.test(normalizedText)
  );
}

function isContextDependentQuestion(normalizedText: string): boolean {
  return (
    isExclusionQuestion(normalizedText) ||
    /^\s*(?:thanks?|thank you|ok|okay|yeah|yes)\b/.test(normalizedText) ||
    /\b(?:those|these|them|that|it|same|previous|above|breakdown)\b/.test(normalizedText)
  );
}

function hasDatePeriod(normalizedText: string): boolean {
  return (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(
      normalizedText,
    ) ||
    /\b(?:last|past|this)\s+(?:month|year|\d+\s+months?)\b/.test(normalizedText) ||
    /\b(?:year\s+to\s+date|so\s+far\s+this\s+year)\b/.test(normalizedText)
  );
}

function createDeterministicFollowUpPlan(
  messageText: string,
  context: {
    transactions: Array<{ category: string; merchant: string; amount: number }>;
    sourceTransactions?: Array<{ category: string; merchant: string; amount: number }>;
  },
): CalculationPlan | undefined {
  const normalizedText = messageText.toLowerCase();
  const availableTransactions = [...(context.sourceTransactions ?? []), ...context.transactions];
  const mentionedCategory = findMentionedCategory(messageText, [
    ...(context.sourceTransactions ?? []),
    ...context.transactions,
  ]);
  const mentionedExcludeMerchants = isExclusionQuestion(normalizedText)
    ? findMentionedMerchants(messageText, availableTransactions)
    : [];

  if (mentionedExcludeMerchants.length > 0) {
    return {
      source: 'previous_transactions',
      operation: 'sum',
      metric: 'expenses',
      filters: {
        ...((mentionedCategory ?? findSingleCategory(context.transactions))
          ? { category: mentionedCategory ?? findSingleCategory(context.transactions) }
          : {}),
        excludeMerchants: mentionedExcludeMerchants,
        excludeMerchantStrategy: /\bsubscription\b/.test(normalizedText) ? 'largest' : 'all',
      },
    };
  }

  if (mentionedCategory && isTotalQuestion(normalizedText)) {
    return {
      source: 'previous_transactions',
      operation: 'sum',
      metric: 'expenses',
      filters: {
        category: mentionedCategory,
      },
    };
  }

  if (mentionedCategory && isListQuestion(normalizedText)) {
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

function isTotalQuestion(normalizedText: string): boolean {
  return /\b(?:total|sum|spend|spending|spent|how much)\b/.test(normalizedText);
}

function isListQuestion(normalizedText: string): boolean {
  return /\b(?:list|show|details?|breakdown)\b/.test(normalizedText);
}

function isExclusionQuestion(normalizedText: string): boolean {
  return /\b(?:remove|exclude|without|minus|take out)\b/.test(normalizedText);
}

function findSingleCategory(transactions: Array<{ category: string }>): string | undefined {
  const categories = new Map<string, string>();

  for (const transaction of transactions) {
    categories.set(normalizeCategory(transaction.category), transaction.category);
  }

  return categories.size === 1 ? [...categories.values()][0] : undefined;
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

function findMentionedMerchants(
  messageText: string,
  transactions: Array<{ merchant: string }>,
): string[] {
  const normalizedText = normalizeMerchant(messageText);
  const merchants = [...new Set(transactions.map((transaction) => transaction.merchant))].sort(
    (left, right) => right.length - left.length,
  );
  const matchedMerchants: string[] = [];

  for (const merchant of merchants) {
    if (merchantPhrases(merchant).some((phrase) => normalizedText.includes(phrase))) {
      matchedMerchants.push(merchant);
    }
  }

  return matchedMerchants.filter(
    (merchant, index) =>
      matchedMerchants.findIndex((candidate) => merchantsOverlap(candidate, merchant)) === index,
  );
}

function merchantPhrases(merchant: string): string[] {
  const normalizedMerchant = normalizeMerchant(merchant);
  const words = normalizedMerchant.split(' ').filter(Boolean);
  const phrases = new Set<string>();

  for (let index = 0; index < words.length - 1; index += 1) {
    phrases.add(`${words[index]} ${words[index + 1]}`);
  }

  for (const word of words) {
    if (word.length >= 5) {
      phrases.add(word);
    }
  }

  return [...phrases].filter((phrase) => phrase.length >= 5);
}

function merchantsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeMerchant(left);
  const normalizedRight = normalizeMerchant(right);

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeMerchant(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function showTypingIndicatorSafely(
  dependencies: WebhookRouterDependencies,
  messageId: string,
): Promise<void> {
  if (typeof dependencies.whatsappService.showTypingIndicator !== 'function') {
    return;
  }

  try {
    await dependencies.whatsappService.showTypingIndicator(messageId);
  } catch (error) {
    dependencies.logger.warn('Failed to show WhatsApp typing indicator.', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
