import OpenAI from 'openai';
import { z } from 'zod';
import type { CalculationPlan } from '../types/calculationPlan.js';
import type { StructuredIntent } from '../types/intent.js';
import {
  calculationPlanSystemPrompt,
  intentExtractionSystemPrompt,
  responseGenerationSystemPrompt,
  smartReplySystemPrompt,
} from '../prompts/systemPrompt.js';

export interface OpenAIServiceOptions {
  apiKey: string;
  model: string;
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface ResponseGenerationInput {
  question: string;
  result: unknown;
  transactionCount: number;
}

const structuredIntentSchema = z.object({
  intent: z.enum([
    'sum_category',
    'sum_merchant',
    'income_total',
    'expense_total',
    'cash_flow',
    'biggest_expenses',
    'biggest_individual_purchases',
    'monthly_totals',
    'average_monthly_spending',
    'median_monthly_spending',
    'unknown',
  ]),
  category: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  merchant: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  dateRange: z
    .enum([
      'this_month',
      'last_month',
      'last_3_months',
      'last_6_months',
      'this_year',
      'last_year',
      'year_to_date',
      'all_time',
      'custom',
    ])
    .default('all_time'),
  startDate: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  endDate: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .transform((value) => value ?? undefined),
});

const calculationPlanSchema = z.object({
  source: z.enum(['previous_result', 'previous_transactions', 'transactions']),
  operation: z.enum([
    'sum',
    'average',
    'median',
    'count',
    'top_n',
    'group_by',
    'list',
    'derive_from_previous',
    'unknown',
  ]),
  filters: z
    .object({
      category: z
        .string()
        .nullable()
        .transform((value) => value ?? undefined),
      merchant: z
        .string()
        .nullable()
        .transform((value) => value ?? undefined),
      excludeCategories: z
        .array(z.string())
        .nullable()
        .transform((value) => value ?? undefined),
    })
    .nullable()
    .transform((value) => value ?? undefined),
  groupBy: z
    .enum(['merchant', 'category', 'merchant_category', 'month'])
    .nullable()
    .transform((value) => value ?? undefined),
  metric: z
    .enum(['amount', 'expenses', 'income', 'cash_flow'])
    .nullable()
    .transform((value) => value ?? undefined),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .transform((value) => value ?? undefined),
  divisor: z
    .number()
    .positive()
    .nullable()
    .transform((value) => value ?? undefined),
  approximate: z
    .boolean()
    .nullable()
    .transform((value) => value ?? undefined),
});

export class OpenAIService {
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIServiceOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  /** Extracts structured bookkeeping intent. The model must not answer the user's question. */
  async extractIntent(question: string): Promise<StructuredIntent> {
    const startedAt = Date.now();
    const response = await this.client.responses.create({
      model: this.options.model,
      input: [
        {
          role: 'system',
          content: intentExtractionSystemPrompt,
        },
        {
          role: 'user',
          content: question,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'bookkeeping_intent',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'intent',
              'category',
              'merchant',
              'dateRange',
              'startDate',
              'endDate',
              'limit',
            ],
            properties: {
              intent: {
                type: 'string',
                enum: [
                  'sum_category',
                  'sum_merchant',
                  'income_total',
                  'expense_total',
                  'cash_flow',
                  'biggest_expenses',
                  'biggest_individual_purchases',
                  'monthly_totals',
                  'average_monthly_spending',
                  'median_monthly_spending',
                  'unknown',
                ],
              },
              category: { type: ['string', 'null'] },
              merchant: { type: ['string', 'null'] },
              dateRange: {
                type: 'string',
                enum: [
                  'this_month',
                  'last_month',
                  'last_3_months',
                  'last_6_months',
                  'this_year',
                  'last_year',
                  'year_to_date',
                  'all_time',
                  'custom',
                ],
              },
              startDate: { type: ['string', 'null'] },
              endDate: { type: ['string', 'null'] },
              limit: { type: ['integer', 'null'] },
            },
          },
        },
      },
    });

    this.options.logger?.info('Extracted OpenAI bookkeeping intent.', {
      durationMs: Date.now() - startedAt,
    });

    return structuredIntentSchema.parse(JSON.parse(response.output_text));
  }

  /** Plans a follow-up calculation using existing conversation context, without doing math. */
  async extractCalculationPlan(
    question: string,
    context: Record<string, unknown>,
  ): Promise<CalculationPlan> {
    const startedAt = Date.now();
    const response = await this.client.responses.create({
      model: this.options.model,
      input: [
        {
          role: 'system',
          content: calculationPlanSystemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            context,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'calculation_plan',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'source',
              'operation',
              'filters',
              'groupBy',
              'metric',
              'limit',
              'divisor',
              'approximate',
            ],
            properties: {
              source: {
                type: 'string',
                enum: ['previous_result', 'previous_transactions', 'transactions'],
              },
              operation: {
                type: 'string',
                enum: [
                  'sum',
                  'average',
                  'median',
                  'count',
                  'top_n',
                  'group_by',
                  'list',
                  'derive_from_previous',
                  'unknown',
                ],
              },
              filters: {
                anyOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['category', 'merchant', 'excludeCategories'],
                    properties: {
                      category: { type: ['string', 'null'] },
                      merchant: { type: ['string', 'null'] },
                      excludeCategories: {
                        anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
                      },
                    },
                  },
                  { type: 'null' },
                ],
              },
              groupBy: {
                type: ['string', 'null'],
                enum: ['merchant', 'category', 'merchant_category', 'month', null],
              },
              metric: {
                type: ['string', 'null'],
                enum: ['amount', 'expenses', 'income', 'cash_flow', null],
              },
              limit: { type: ['integer', 'null'] },
              divisor: { type: ['number', 'null'] },
              approximate: { type: ['boolean', 'null'] },
            },
          },
        },
      },
    });

    this.options.logger?.info('Extracted OpenAI calculation plan.', {
      durationMs: Date.now() - startedAt,
    });

    return calculationPlanSchema.parse(JSON.parse(response.output_text));
  }

  /** Turns completed deterministic results into a friendly conversational reply. */
  async generateResponse(input: ResponseGenerationInput): Promise<string> {
    const startedAt = Date.now();
    const response = await this.client.responses.create({
      model: this.options.model,
      input: [
        {
          role: 'system',
          content: responseGenerationSystemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    });

    this.options.logger?.info('Generated OpenAI bookkeeping response.', {
      durationMs: Date.now() - startedAt,
    });

    return response.output_text;
  }

  /** Generates a safe pre-bookkeeping reply without inventing financial facts. */
  async generateSmartReply(question: string): Promise<string> {
    const startedAt = Date.now();
    const response = await this.client.responses.create({
      model: this.options.model,
      input: [
        {
          role: 'system',
          content: smartReplySystemPrompt,
        },
        {
          role: 'user',
          content: question,
        },
      ],
    });

    this.options.logger?.info('Generated OpenAI smart reply.', {
      durationMs: Date.now() - startedAt,
    });

    return response.output_text;
  }
}
