# Penny

Penny is an AI-powered WhatsApp bookkeeper. In the MVP, WhatsApp messages are routed through a backend API, bookkeeping data is read from Google Sheets, deterministic calculations are performed in TypeScript, and OpenAI is used only for intent extraction and friendly response generation.

## Stack

- TypeScript
- Node.js
- Express
- Meta WhatsApp Cloud API
- OpenAI Responses API
- Google Sheets API
- Vitest
- ESLint
- Prettier
- dotenv

## Getting Started

```bash
npm install
cp .env.example .env
npm run build
npm test
npm run dev
```

The server starts on `PORT`, defaulting to `3000`.

## Endpoints

- `GET /health` returns service health.
- `GET /webhook` verifies the Meta webhook challenge.
- `POST /webhook` receives WhatsApp messages and sends replies.

## Spreadsheet Contract

Phase 1 expects a Google Sheet range with columns:

```text
Date | Merchant | Category | Amount | Account
```

The Google Sheets service maps rows into normalized `Transaction` objects. Calculations are intentionally kept out of the Sheets integration so future providers such as QuickBooks, Xero, Plaid, or PostgreSQL can reuse the same domain services.

## Environment Variables

See `.env.example` for required configuration.

## Architecture

```text
src/
  api/
    webhook.ts
    verify.ts
    health.ts
  services/
    whatsapp.ts
    openai.ts
    sheets.ts
    calculator.ts
    intent.ts
  models/
    transaction.ts
  types/
  utils/
    dates.ts
    currency.ts
    logger.ts
  prompts/
    systemPrompt.ts
  index.ts
tests/
```

Services are small, focused, and composed through dependency injection in the API layer.
