import OpenAI from 'openai';
import { z } from 'zod';
import type { StructuredIntent } from '../types/intent.js';
import {
  intentExtractionSystemPrompt,
  responseGenerationSystemPrompt,
} from '../prompts/systemPrompt.js';

export interface OpenAIServiceOptions {
  apiKey: string;
  model: string;
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
    'monthly_totals',
    'unknown',
  ]),
  category: z.string().optional(),
  merchant: z.string().optional(),
  dateRange: z
    .enum([
      'this_month',
      'last_month',
      'this_year',
      'last_year',
      'year_to_date',
      'all_time',
      'custom',
    ])
    .default('all_time'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export class OpenAIService {
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIServiceOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  /** Extracts structured bookkeeping intent. The model must not answer the user's question. */
  async extractIntent(question: string): Promise<StructuredIntent> {
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
            required: ['intent', 'dateRange'],
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
                  'monthly_totals',
                  'unknown',
                ],
              },
              category: { type: 'string' },
              merchant: { type: 'string' },
              dateRange: {
                type: 'string',
                enum: [
                  'this_month',
                  'last_month',
                  'this_year',
                  'last_year',
                  'year_to_date',
                  'all_time',
                  'custom',
                ],
              },
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              limit: { type: 'integer' },
            },
          },
        },
      },
    });

    return structuredIntentSchema.parse(JSON.parse(response.output_text));
  }

  /** Turns completed deterministic results into a friendly conversational reply. */
  async generateResponse(input: ResponseGenerationInput): Promise<string> {
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

    return response.output_text;
  }
}
