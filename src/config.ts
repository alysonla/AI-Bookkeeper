import 'dotenv/config';
import type { AppConfig } from './types/config.js';

export function loadConfig(): AppConfig {
  const whatsappSmokeTest = readBoolean('WHATSAPP_SMOKE_TEST', false);
  const whatsappSmartReplies = readBoolean('WHATSAPP_SMART_REPLIES', false);
  const needsBookkeepingData = !whatsappSmokeTest && !whatsappSmartReplies;

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
      whatsappSmartReplies,
    },
    openai: {
      apiKey: readString('OPENAI_API_KEY', whatsappSmokeTest ? 'unused-in-smoke-test' : undefined),
      model: readString('OPENAI_MODEL', 'gpt-5.1'),
    },
    googleSheets: {
      spreadsheetId: readString(
        'GOOGLE_SHEETS_SPREADSHEET_ID',
        needsBookkeepingData ? undefined : 'unused-in-non-bookkeeping-mode',
      ),
      range: readString('GOOGLE_SHEETS_RANGE', 'Transactions!A:E'),
      cacheTtlMs: readNumber('GOOGLE_SHEETS_CACHE_TTL_MS', 60000),
      keyFile: readOptionalString('GOOGLE_SERVICE_ACCOUNT_KEY_FILE'),
      serviceAccountEmail: readString(
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        needsBookkeepingData && !readOptionalString('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
          ? undefined
          : 'unused-in-non-bookkeeping-mode',
      ),
      privateKey: readString(
        'GOOGLE_PRIVATE_KEY',
        needsBookkeepingData && !readOptionalString('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
          ? undefined
          : 'unused-in-non-bookkeeping-mode',
      ).replace(/\\n/g, '\n'),
    },
  };
}

function readString(name: string, fallback?: string): string {
  const rawValue = process.env[name];
  const value = rawValue && rawValue.trim().length > 0 ? rawValue : fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
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
