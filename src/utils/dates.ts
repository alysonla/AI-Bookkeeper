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
): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'this_month':
      return { start: startOfMonth(year, month), end: endOfMonth(year, month) };
    case 'last_month':
      return { start: startOfMonth(year, month - 1), end: endOfMonth(year, month - 1) };
    case 'this_year':
    case 'year_to_date':
      return { start: new Date(year, 0, 1), end: endOfDay(now) };
    case 'last_year':
      return { start: new Date(year - 1, 0, 1), end: endOfDay(new Date(year - 1, 11, 31)) };
    case 'custom':
      if (!customStart || !customEnd) {
        throw new Error('Custom date ranges require startDate and endDate.');
      }
      return { start: startOfDay(new Date(customStart)), end: endOfDay(new Date(customEnd)) };
    case 'all_time':
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
