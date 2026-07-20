import OpenAI from 'openai';
import { z } from 'zod';
import type { StructuredIntent } from '../types/intent.js';
import {
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
