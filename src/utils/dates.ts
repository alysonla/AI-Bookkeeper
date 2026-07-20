import type { DateRangePreset } from '../types/intent.js';

export interface DateRange {
  start: Date;
  end: Date;
}

export function resolveDateRange(
  preset: DateRangePreset,
  now = new Date(),
  customStart?: string,
  customEnd?: string,
  sourceText?: string,
): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'this_month':
      return { start: startOfMonth(year, month), end: endOfMonth(year, month) };
    case 'last_month':
      return { start: startOfMonth(year, month - 1), end: endOfMonth(year, month - 1) };
    case 'last_3_months':
      return { start: startOfMonth(year, month - 3), end: endOfMonth(year, month - 1) };
    case 'last_6_months':
      return { start: startOfMonth(year, month - 6), end: endOfMonth(year, month - 1) };
    case 'this_year':
    case 'year_to_date':
      return { start: new Date(year, 0, 1), end: endOfDay(now) };
    case 'last_year':
      return { start: new Date(year - 1, 0, 1), end: endOfDay(new Date(year - 1, 11, 31)) };
    case 'custom':
      if (customStart && customEnd) {
        return { start: startOfDay(new Date(customStart)), end: endOfDay(new Date(customEnd)) };
      }

      if (sourceText) {
        const textRange = resolveDateRangeFromText(sourceText, now);

        if (textRange) {
          return textRange;
        }
      }

      throw new Error('Custom date ranges require startDate and endDate.');
    case 'all_time':
      if (sourceText) {
        const textRange = resolveDateRangeFromText(sourceText, now);

        if (textRange) {
          return textRange;
        }
      }

      return { start: new Date(0), end: new Date(8640000000000000) };
  }
}

export function isWithinDateRange(date: Date, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function endOfMonth(year: number, month: number): Date {
  return endOfDay(new Date(year, month + 1, 0));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function resolveDateRangeFromText(sourceText: string, now: Date): DateRange | undefined {
  const lowerSourceText = sourceText.toLowerCase();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (/\b(?:last|past)\s+month\b/.test(lowerSourceText)) {
    return { start: startOfMonth(year, month - 1), end: endOfMonth(year, month - 1) };
  }

  if (/\bthis\s+month\b/.test(lowerSourceText)) {
    return { start: startOfMonth(year, month), end: endOfMonth(year, month) };
  }

  if (/\b(?:last|past)\s+3\s+months?\b/.test(lowerSourceText)) {
    return { start: startOfMonth(year, month - 3), end: endOfMonth(year, month - 1) };
  }

  if (/\b(?:last|past)\s+6\s+months?\b/.test(lowerSourceText)) {
    return { start: startOfMonth(year, month - 6), end: endOfMonth(year, month - 1) };
  }

  if (/\b(?:this\s+year|year\s+to\s+date|so\s+far\s+this\s+year)\b/.test(lowerSourceText)) {
    return { start: new Date(year, 0, 1), end: endOfDay(now) };
  }

  if (/\blast\s+year\b/.test(lowerSourceText)) {
    return { start: new Date(year - 1, 0, 1), end: endOfDay(new Date(year - 1, 11, 31)) };
  }

  return resolveMonthNameRange(sourceText, now);
}

function resolveMonthNameRange(sourceText: string, now: Date): DateRange | undefined {
  const lowerSourceText = sourceText.toLowerCase();
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  const monthIndex = months.findIndex((monthName) =>
    new RegExp(`\\b${monthName.slice(0, 3)}(?:${monthName.slice(3)})?\\b`).test(lowerSourceText),
  );

  if (monthIndex === -1) {
    return undefined;
  }

  const explicitYear = lowerSourceText.match(/\b(20\d{2})\b/)?.[1];
  const resolvedYear = explicitYear
    ? Number(explicitYear)
    : monthIndex > now.getMonth()
      ? now.getFullYear() - 1
      : now.getFullYear();

  return {
    start: startOfMonth(resolvedYear, monthIndex),
    end: endOfMonth(resolvedYear, monthIndex),
  };
}
