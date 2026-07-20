# Add Calculation Planning Layer for Natural Language Follow-Ups

## Summary

Add a calculation planning layer so Penny can answer a wider range of natural language bookkeeping questions and follow-ups without hard-coding every possible phrase.

## Background

Penny currently maps user messages to a small set of structured intents, then runs deterministic calculations. This works for simple direct questions, but breaks down on natural follow-ups like:

```text
so thats like $8k on average each month yeah?
```

after Penny previously answered:

```text
You spent $49,149.74 in the last 6 months across 665 transactions.
```

Penny should understand that the follow-up refers to the previous result and should deterministically calculate:

```text
49149.74 / 6 = 8191.62
```

The LLM should interpret the user's request, but TypeScript should still perform all math.

## Goals

- Replace or augment the one-intent-per-question approach with a calculation planning layer.
- Support natural follow-up questions that reference previous results.
- Keep deterministic calculations in TypeScript.
- Prevent the LLM from inventing financial numbers.
- Make Penny feel more conversational without sacrificing correctness.
- Reduce the need to hard-code every user phrase.

## Non-Goals

- Long-term persistent memory.
- Multi-user account management.
- Production database storage.
- Replacing deterministic calculations with LLM math.
- Full SQL/query-language support.
- Complex accounting reports beyond the current MVP scope.

## Product Examples

### Approximate Monthly Average Follow-Up

User asks:

```text
what is my total spending in the last 6 months?
```

Penny replies:

```text
You spent $49,149.74 in the last 6 completed months across 665 transactions.
```

User follows up:

```text
so thats like $8k on average each month yeah?
```

Expected Penny reply:

```text
Yep, that works out to about $8,191.62 per month, so roughly $8.2k/month.
```

### Grouping Follow-Up

User asks:

```text
what were my biggest expenses so far this year?
```

Penny replies with grouped merchant/category totals.

User follows up:

```text
what about by category?
```

Expected behavior:

- Penny reuses the same date range.
- Penny groups the same transaction set by category.
- TypeScript calculates totals.
- Penny replies with category totals.

### Filter Follow-Up

User asks:

```text
what did I spend on groceries last month?
```

Penny replies with total grocery spending.

User follows up:

```text
just Costco
```

Expected behavior:

- Penny reuses the previous date range.
- Penny adds a merchant filter for Costco.
- TypeScript calculates the new total.
- Penny replies with the Costco subset.

## Proposed Architecture

Introduce a calculation plan abstraction:

```ts
interface CalculationPlan {
  source: 'transactions' | 'previous_result' | 'previous_transactions';
  operation: 'sum' | 'average' | 'count' | 'top_n' | 'group_by' | 'list' | 'derive_from_previous';
  filters?: {
    category?: string;
    merchant?: string;
    dateRange?: string;
    startDate?: string;
    endDate?: string;
    excludeCategories?: string[];
  };
  groupBy?: 'merchant' | 'category' | 'merchant_category' | 'month';
  metric?: 'amount' | 'expenses' | 'income' | 'cash_flow';
  limit?: number;
  divisor?: number;
  approximate?: boolean;
}
```

## Execution Flow

```text
WhatsApp message
↓
Load recent conversation context
↓
OpenAI extracts CalculationPlan
↓
PlanExecutor runs deterministic calculation
↓
Save updated context
↓
OpenAI generates friendly response from computed result
↓
Send WhatsApp reply
```

## Conversation Context

Store short-lived in-memory context per WhatsApp sender:

```ts
interface ConversationContext {
  lastQuestion: string;
  lastPlan: CalculationPlan;
  lastResult: unknown;
  lastTransactions: Transaction[];
  dateRange?: {
    label: string;
    start: Date;
    end: Date;
  };
  createdAt: Date;
}
```

Context should expire after a short TTL, such as 10 minutes.

## Deterministic Operations

Support these initial operations:

- `sum`
- `average`
- `count`
- `top_n`
- `group_by`
- `list`
- `derive_from_previous`

Examples:

```json
{
  "source": "previous_result",
  "operation": "derive_from_previous",
  "metric": "expenses",
  "divisor": 6,
  "approximate": true
}
```

```json
{
  "source": "previous_transactions",
  "operation": "group_by",
  "groupBy": "category",
  "metric": "expenses"
}
```

```json
{
  "source": "previous_transactions",
  "operation": "sum",
  "filters": {
    "merchant": "Costco"
  },
  "metric": "expenses"
}
```

## Safety Rules

- OpenAI may classify intent and create calculation plans.
- OpenAI may not calculate totals, averages, counts, or rankings.
- All math must happen in TypeScript.
- If the plan references previous context but no context exists, Penny should ask a brief clarifying question.
- Transfers should be excluded from expense-style calculations by default.
- Penny should state when a response is approximate.

## Acceptance Criteria

- Penny can answer follow-ups like:

```text
so thats like $8k on average each month yeah?
```

- Penny can derive averages from a previous total using deterministic code.
- Penny can reuse the previous date range for follow-up questions.
- Penny can group previous transaction results by category.
- Penny can apply a new merchant/category filter to previous transaction results.
- Penny does not rely on LLM-generated math.
- Existing direct questions still work.
- Existing smoke-test and smart-reply modes still work.
- Typecheck, build, lint, tests, and format all pass.

## Test Plan

Run:

```bash
npm run typecheck
npm run build
npm run lint
npm test
npm run format
```

Add tests for:

- calculation plan schema parsing
- derive average from previous result
- group previous transactions by category
- filter previous transactions by merchant
- missing previous context fallback
- transfer exclusion
- approximate result wording
- existing intent flows continuing to work

## Suggested Implementation Steps

1. Add `CalculationPlan` types.
2. Add `PlanExecutorService`.
3. Extend `ConversationService` to store last plan/result/date range/transactions.
4. Add OpenAI plan extraction method.
5. Route full bookkeeping mode through plan extraction where safe.
6. Keep existing intent path as fallback during transition.
7. Add tests for common follow-up workflows.
8. Update README with the calculation planning architecture.
