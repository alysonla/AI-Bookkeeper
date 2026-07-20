export type IntentName =
  | 'sum_category'
  | 'sum_merchant'
  | 'income_total'
  | 'expense_total'
  | 'cash_flow'
  | 'biggest_expenses'
  | 'monthly_totals'
  | 'unknown';

export type DateRangePreset =
  'this_month' | 'last_month' | 'this_year' | 'last_year' | 'year_to_date' | 'all_time' | 'custom';

export interface StructuredIntent {
  intent: IntentName;
  category?: string;
  merchant?: string;
  dateRange: DateRangePreset;
  startDate?: string;
  endDate?: string;
  limit?: number;
}
