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

## WhatsApp Local Setup

Meta requires a public HTTPS callback URL for webhook verification. For local development, run Penny locally and expose it with an HTTPS tunnel such as ngrok or Cloudflare Tunnel.

1. Create or open a Meta developer app at [Meta for Developers](https://developers.facebook.com/).
2. Add the WhatsApp product.
3. Copy the WhatsApp Phone Number ID into `META_PHONE_NUMBER_ID`.
4. Copy a temporary or permanent Meta access token into `META_ACCESS_TOKEN`.
5. Choose a local secret value for `META_VERIFY_TOKEN`.
6. Enable smoke-test mode while validating WhatsApp plumbing:

   ```bash
   WHATSAPP_SMOKE_TEST=true
   ```

7. Start Penny:

   ```bash
   npm run dev
   ```

8. Expose the local server over HTTPS:

   ```bash
   ngrok http 3000
   ```

9. In the Meta app dashboard, configure the WhatsApp webhook:
   - Callback URL: `https://<your-tunnel-domain>/webhook`
   - Verify token: the same value as `META_VERIFY_TOKEN`
   - Subscribe to the `messages` webhook field

10. Send a WhatsApp test message to the Meta test business number.

When `WHATSAPP_SMOKE_TEST=true`, Penny replies with:

```text
Penny received: <incoming message>
```

This confirms webhook verification, inbound message parsing, and outbound WhatsApp replies without calling OpenAI or Google Sheets. Disable smoke-test mode to run the full bookkeeping flow.

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
