import { auth, sheets } from '@googleapis/sheets';
import type { Transaction } from '../models/transaction.js';
import { parseCurrencyAmount } from '../utils/currency.js';

export interface SheetsServiceOptions {
  spreadsheetId: string;
  range: string;
  serviceAccountEmail: string;
  privateKey: string;
}

export class SheetsService {
  constructor(private readonly options: SheetsServiceOptions) {}

  /** Reads and normalizes transaction rows from Google Sheets. */
  async listTransactions(): Promise<Transaction[]> {
    const client = new auth.JWT({
      email: this.options.serviceAccountEmail,
      key: this.options.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheetsClient = sheets({ version: 'v4', auth: client });
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: this.options.spreadsheetId,
      range: this.options.range,
    });

    return this.normalizeRows(response.data.values ?? []);
  }

  /** Converts raw sheet rows to canonical transaction objects. */
  normalizeRows(rows: unknown[][]): Transaction[] {
    const [, ...dataRows] = rows;

    return dataRows
      .filter((row) => row.length >= 4)
      .map((row) => ({
        date: parseDate(row[0]),
        merchant: parseRequiredString(row[1], 'merchant'),
        category: parseRequiredString(row[2], 'category'),
        amount: parseCurrencyAmount(row[3]),
        account: row[4] ? parseRequiredString(row[4], 'account') : undefined,
      }));
  }
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid date value: ${String(value)}`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }

  return date;
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required ${fieldName}.`);
  }

  return value.trim();
}
