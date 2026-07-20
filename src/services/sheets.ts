import { auth, sheets } from '@googleapis/sheets';
import type { Transaction } from '../models/transaction.js';
import { parseCurrencyAmount } from '../utils/currency.js';
import type { Logger } from '../utils/logger.js';

export interface SheetsServiceOptions {
  spreadsheetId: string;
  range: string;
  cacheTtlMs: number;
  keyFile?: string;
  serviceAccountEmail: string;
  privateKey: string;
  logger?: Logger;
}

export class SheetsService {
  private cachedTransactions?: { transactions: Transaction[]; expiresAt: number };

  constructor(private readonly options: SheetsServiceOptions) {}

  /** Reads and normalizes transaction rows from Google Sheets. */
  async listTransactions(): Promise<Transaction[]> {
    const cachedTransactions = this.getCachedTransactions();

    if (cachedTransactions) {
      return cachedTransactions;
    }

    const client = this.createAuthClient();
    const startedAt = Date.now();

    this.options.logger?.info('Reading transactions from Google Sheets.', {
      spreadsheetId: this.options.spreadsheetId,
      range: this.options.range,
      authMode: this.options.keyFile ? 'key_file' : 'service_account_fields',
    });

    const sheetsClient = sheets({ version: 'v4', auth: client });
    try {
      const response = await sheetsClient.spreadsheets.values.get(
        {
          spreadsheetId: this.options.spreadsheetId,
          range: this.options.range,
        },
        {
          retry: false,
        },
      );

      const rows = response.data.values ?? [];
      const transactions = this.normalizeRows(rows);
      this.cacheTransactions(transactions);

      this.options.logger?.info('Read transactions from Google Sheets.', {
        rowCount: rows.length,
        transactionCount: transactions.length,
        durationMs: Date.now() - startedAt,
      });

      return transactions;
    } catch (error) {
      this.options.logger?.error('Failed to read transactions from Google Sheets.', {
        spreadsheetId: this.options.spreadsheetId,
        range: this.options.range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private getCachedTransactions(): Transaction[] | undefined {
    if (!this.cachedTransactions || Date.now() >= this.cachedTransactions.expiresAt) {
      return undefined;
    }

    this.options.logger?.info('Using cached Google Sheets transactions.', {
      transactionCount: this.cachedTransactions.transactions.length,
      cacheTtlMs: this.options.cacheTtlMs,
    });

    return this.cachedTransactions.transactions;
  }

  private cacheTransactions(transactions: Transaction[]): void {
    if (this.options.cacheTtlMs <= 0) {
      return;
    }

    this.cachedTransactions = {
      transactions,
      expiresAt: Date.now() + this.options.cacheTtlMs,
    };
  }

  private createAuthClient() {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

    if (this.options.keyFile) {
      return new auth.GoogleAuth({
        keyFile: this.options.keyFile,
        scopes,
      });
    }

    return new auth.JWT({
      email: this.options.serviceAccountEmail,
      key: this.options.privateKey,
      scopes,
    });
  }

  /** Converts raw sheet rows to canonical transaction objects. */
  normalizeRows(rows: unknown[][]): Transaction[] {
    const [headerRow, ...dataRows] = rows;

    if (!headerRow) {
      return [];
    }

    const headers = createHeaderIndex(headerRow);
    const dateIndex = requireHeader(headers, 'Date');
    const descriptionIndex = requireHeader(headers, 'Description');
    const categoryIndex = requireHeader(headers, 'Category');
    const amountIndex = requireHeader(headers, 'Amount');
    const accountIndex = headers.get(normalizeHeader('Account'));

    const transactions: Transaction[] = [];

    dataRows.forEach((row, index) => {
      const rowNumber = index + 2;

      if (isBlankRow(row)) {
        return;
      }

      try {
        transactions.push({
          date: parseDate(row[dateIndex], rowNumber),
          merchant: parseRequiredString(row[descriptionIndex], 'Description', rowNumber),
          category: parseRequiredString(row[categoryIndex], 'Category', rowNumber),
          amount: parseAmount(row[amountIndex], rowNumber),
          account:
            accountIndex !== undefined && row[accountIndex]
              ? parseRequiredString(row[accountIndex], 'Account', rowNumber)
              : undefined,
        });
      } catch (error) {
        this.options.logger?.warn('Skipping invalid transaction row from Google Sheets.', {
          rowNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return transactions;
  }
}

function createHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const headers = new Map<string, number>();

  headerRow.forEach((header, index) => {
    if (typeof header === 'string' && header.trim().length > 0) {
      headers.set(normalizeHeader(header), index);
    }
  });

  return headers;
}

function requireHeader(headers: Map<string, number>, headerName: string): number {
  const index = headers.get(normalizeHeader(headerName));

  if (index === undefined) {
    throw new Error(`Missing required sheet header: ${headerName}`);
  }

  return index;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((value) => value === undefined || String(value).trim().length === 0);
}

function parseDate(value: unknown, rowNumber: number): Date {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid Date on row ${rowNumber}: ${String(value)}`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Date on row ${rowNumber}: ${String(value)}`);
  }

  return date;
}

function parseAmount(value: unknown, rowNumber: number): number {
  try {
    return parseCurrencyAmount(value);
  } catch (error) {
    throw new Error(
      `Invalid Amount on row ${rowNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseRequiredString(value: unknown, fieldName: string, rowNumber: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required ${fieldName} on row ${rowNumber}.`);
  }

  return value.trim();
}
