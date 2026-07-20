import { describe, expect, it } from 'vitest';
import { SheetsService } from '../src/services/sheets.js';

const service = new SheetsService({
  spreadsheetId: 'spreadsheet-id',
  range: 'Transactions!A:M',
  cacheTtlMs: 60000,
  serviceAccountEmail: 'unused@example.com',
  privateKey: 'unused',
});

describe('SheetsService', () => {
  it('normalizes rows using the real transaction headers', () => {
    const transactions = service.normalizeRows([
      [
        'Date',
        'Description',
        'Category',
        'Amount',
        'Account',
        'Account #',
        'Institution',
        'Month',
        'Week',
        'Transaction ID',
        'Account ID',
        'Notes',
        'Full Description',
      ],
      [
        '2026-07-01',
        'Costco',
        'Groceries',
        '$142.18',
        'Chase Checking',
        '1234',
        'Chase',
        'July 2026',
        '2026-W27',
        'txn_001',
        'acct_001',
        '',
        'Costco Wholesale #123',
      ],
    ]);

    expect(transactions).toEqual([
      {
        date: new Date('2026-07-01'),
        merchant: 'Costco',
        category: 'Groceries',
        amount: 142.18,
        account: 'Chase Checking',
      },
    ]);
  });

  it('requires the Description header', () => {
    expect(() =>
      service.normalizeRows([
        ['Date', 'Category', 'Amount'],
        ['2026-07-01', 'Groceries', '-10'],
      ]),
    ).toThrow('Missing required sheet header: Description');
  });

  it('skips invalid data rows', () => {
    const transactions = service.normalizeRows([
      ['Date', 'Description', 'Category', 'Amount'],
      ['nope', 'Costco', 'Groceries', '-10'],
      ['2026-07-01', 'Trader Joe', 'Groceries', '-20'],
    ]);

    expect(transactions).toEqual([
      {
        date: new Date('2026-07-01'),
        merchant: 'Trader Joe',
        category: 'Groceries',
        amount: -20,
      },
    ]);
  });

  it('ignores blank rows', () => {
    const transactions = service.normalizeRows([
      ['Date', 'Description', 'Category', 'Amount'],
      ['', '', '', ''],
      ['2026-07-01', 'Trader Joe', 'Groceries', '-20'],
    ]);

    expect(transactions).toHaveLength(1);
  });
});
