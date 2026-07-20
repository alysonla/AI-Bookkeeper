import 'dotenv/config';
import type { AppConfig } from './types/config.js';

export function loadConfig(): AppConfig {
  const whatsappSmokeTest = readBoolean('WHATSAPP_SMOKE_TEST', false);

  return {
    port: readNumber('PORT', 3000),
    nodeEnv: readString('NODE_ENV', 'development'),
    logLevel: readString('LOG_LEVEL', 'info'),
    meta: {
      verifyToken: readString('META_VERIFY_TOKEN'),
      accessToken: readString('META_ACCESS_TOKEN'),
      phoneNumberId: readString('META_PHONE_NUMBER_ID'),
    },
    features: {
      whatsappSmokeTest,
    },
    openai: {
      apiKey: readString('OPENAI_API_KEY', whatsappSmokeTest ? 'unused-in-smoke-test' : undefined),
      model: readString('OPENAI_MODEL', 'gpt-4.1-mini'),
    },
    googleSheets: {
      spreadsheetId: readString(
        'GOOGLE_SHEETS_SPREADSHEET_ID',
        whatsappSmokeTest ? 'unused-in-smoke-test' : undefined,
      ),
      range: readString('GOOGLE_SHEETS_RANGE', 'Transactions!A:E'),
      serviceAccountEmail: readString(
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        whatsappSmokeTest ? 'unused-in-smoke-test' : undefined,
      ),
      privateKey: readString(
        'GOOGLE_PRIVATE_KEY',
        whatsappSmokeTest ? 'unused-in-smoke-test' : undefined,
      ).replace(/\\n/g, '\n'),
    },
  };
}

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Environment variable ${name} must be true or false.`);
}
