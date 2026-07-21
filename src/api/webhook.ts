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

type WhatsAppProcessingRoute =
  | 'smoke_test'
  | 'smart_reply'
  | 'calculation_plan_follow_up'
  | 'breakdown_follow_up'
  | 'fresh_bookkeeping';

interface MessageTrace {
  traceId: string;
  messageId: string;
  startedAt: number;
}

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
      const trace = createMessageTrace(message.id);

      dependencies.logger.info('Started WhatsApp message processing.', {
        ...messageTraceMeta(trace),
        textLength: message.text.length,
        webhookTimestamp: message.timestamp,
      });

      try {
        await showTypingIndicatorSafely(dependencies, trace);

        if (dependencies.whatsappSmokeTest) {
          logSelectedRoute(dependencies.logger, trace, 'smoke_test');
          await dependencies.whatsappService.sendReply(
            message.from,
            `Penny received: ${message.text}`,
          );
          logCompletedProcessing(dependencies.logger, trace, 'smoke_test');
          return;
        }

        if (dependencies.whatsappSmartReplies) {
          logSelectedRoute(dependencies.logger, trace, 'smart_reply');
          const reply = await dependencies.openAIService.generateSmartReply(message.text);
          await dependencies.whatsappService.sendReply(message.from, reply);
          logCompletedProcessing(dependencies.logger, trace, 'smart_reply');
          return;
        }

        const plannedResult = await tryProcessCalculationPlan(
          dependencies,
          message.from,
          message.text,
          trace,
        );

        if (plannedResult) {
          logSelectedRoute(dependencies.logger, trace, 'calculation_plan_follow_up', {
            transactionCount: plannedResult.transactionCount,
            ...describeCalculationResult(plannedResult.result),
          });
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
          logCompletedProcessing(dependencies.logger, trace, 'calculation_plan_follow_up', {
            transactionCount: plannedResult.transactionCount,
            ...describeCalculationResult(plannedResult.result),
          });
          return;
        }

        if (
          dependencies.conversationService?.isBreakdownRequest(message.text) &&
          dependencies.conversationService.getBreakdownContext(message.from)
        ) {
          const context = dependencies.conversationService.getBreakdownContext(message.from);
          const includeCategory = dependencies.conversationService.shouldIncludeCategory(
            message.text,
          );
          logSelectedRoute(dependencies.logger, trace, 'breakdown_follow_up', {
            transactionCount: context?.transactions.length ?? 0,
            includeCategory,
          });
          const reply = dependencies.conversationService.formatBreakdown(
            context?.transactions ?? [],
            {
              includeCategory,
            },
          );
          await dependencies.whatsappService.sendReply(message.from, reply);
          logCompletedProcessing(dependencies.logger, trace, 'breakdown_follow_up', {
            transactionCount: context?.transactions.length ?? 0,
            includeCategory,
          });
          return;
        }

        logSelectedRoute(dependencies.logger, trace, 'fresh_bookkeeping');
        const intent = await dependencies.openAIService.extractIntent(message.text);
        dependencies.logger.info('Extracted WhatsApp bookkeeping intent.', {
          ...messageTraceMeta(trace),
          ...describeIntent(intent),
        });
        const transactions = await dependencies.sheetsService.listTransactions();
        dependencies.logger.info('Loaded WhatsApp bookkeeping transactions.', {
          ...messageTraceMeta(trace),
          sourceTransactionCount: transactions.length,
        });
        const calculation = dependencies.intentService.processIntent(
          intent,
          transactions,
          new Date(),
          message.text,
        );
        dependencies.logger.info('Calculated WhatsApp bookkeeping result.', {
          ...messageTraceMeta(trace),
          transactionCount: calculation.transactionCount,
          sourceTransactionCount:
            calculation.sourceTransactions?.length ?? calculation.transactions.length,
          ...describeCalculationResult(calculation.result),
        });
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
        logCompletedProcessing(dependencies.logger, trace, 'fresh_bookkeeping', {
          transactionCount: calculation.transactionCount,
          sourceTransactionCount:
            calculation.sourceTransactions?.length ?? calculation.transactions.length,
          ...describeCalculationResult(calculation.result),
        });
      } catch (error) {
        dependencies.logger.error('Failed to process incoming WhatsApp message.', {
          ...messageTraceMeta(trace),
          durationMs: elapsedMs(trace),
          error: error instanceof Error ? error.message : String(error),
        });

        await sendReplySafely(
          dependencies,
          message.from,
          'Sorry, I had trouble answering that bookkeeping question. Please try again in a moment.',
          trace,
        );
      }
    }),
  );
}

async function tryProcessCalculationPlan(
  dependencies: WebhookRouterDependencies,
  userId: string,
  messageText: string,
  trace: MessageTrace,
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
      ...messageTraceMeta(trace),
      operation: plan.operation,
      source: plan.source,
      transactionCount: result.transactionCount,
      ...describeCalculationResult(result.result),
    });

    return result;
  } catch (error) {
    dependencies.logger.warn('Could not execute calculation plan from conversation context.', {
      ...messageTraceMeta(trace),
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
  trace: MessageTrace,
): Promise<void> {
  if (typeof dependencies.whatsappService.showTypingIndicator !== 'function') {
    return;
  }

  try {
    await dependencies.whatsappService.showTypingIndicator(trace.messageId);
    dependencies.logger.info('Requested WhatsApp typing indicator.', messageTraceMeta(trace));
  } catch (error) {
    dependencies.logger.warn('Failed to show WhatsApp typing indicator.', {
      ...messageTraceMeta(trace),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendReplySafely(
  dependencies: WebhookRouterDependencies,
  to: string,
  reply: string,
  trace: MessageTrace,
): Promise<void> {
  try {
    await dependencies.whatsappService.sendReply(to, reply);
  } catch (error) {
    dependencies.logger.error('Failed to send WhatsApp fallback reply.', {
      ...messageTraceMeta(trace),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createMessageTrace(messageId: string): MessageTrace {
  return {
    traceId: `wa_${messageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'message'}`,
    messageId,
    startedAt: Date.now(),
  };
}

function messageTraceMeta(trace: MessageTrace): Pick<MessageTrace, 'traceId' | 'messageId'> {
  return {
    traceId: trace.traceId,
    messageId: trace.messageId,
  };
}

function logSelectedRoute(
  logger: Logger,
  trace: MessageTrace,
  route: WhatsAppProcessingRoute,
  meta: Record<string, unknown> = {},
): void {
  logger.info('Selected WhatsApp processing route.', {
    ...messageTraceMeta(trace),
    route,
    ...meta,
  });
}

function logCompletedProcessing(
  logger: Logger,
  trace: MessageTrace,
  route: WhatsAppProcessingRoute,
  meta: Record<string, unknown> = {},
): void {
  logger.info('Completed WhatsApp message processing.', {
    ...messageTraceMeta(trace),
    route,
    durationMs: elapsedMs(trace),
    ...meta,
  });
}

function elapsedMs(trace: MessageTrace): number {
  return Date.now() - trace.startedAt;
}

function describeIntent(intent: {
  intent: string;
  dateRange: string;
  category?: string;
  categories?: string[];
  merchant?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
}): Record<string, unknown> {
  return {
    intent: intent.intent,
    dateRange: intent.dateRange,
    categoryCount: (intent.category ? 1 : 0) + (intent.categories?.length ?? 0),
    hasMerchant: Boolean(intent.merchant),
    hasLimit: typeof intent.limit === 'number',
    hasCustomDateRange: Boolean(intent.startDate || intent.endDate),
  };
}

function describeCalculationResult(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    return {
      resultType: 'array',
      resultLength: result.length,
    };
  }

  if (result === null) {
    return {
      resultType: 'null',
    };
  }

  if (typeof result !== 'object') {
    return {
      resultType: typeof result,
    };
  }

  const resultRecord = result as Record<string, unknown>;
  const operation = resultRecord.operation;

  return {
    resultType: 'object',
    resultKeys: Object.keys(resultRecord).sort(),
    ...(typeof operation === 'string' ? { operation } : {}),
  };
}
