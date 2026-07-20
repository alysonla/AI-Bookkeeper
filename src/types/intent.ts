export type IntentName =
  | 'sum_category'
  | 'sum_merchant'
  | 'income_total'
  | 'expense_total'
  | 'cash_flow'
  | 'category_totals'
  | 'category_expense_comparison'
  | 'biggest_expenses'
  | 'biggest_individual_purchases'
  | 'monthly_totals'
  | 'average_monthly_spending'
  | 'median_monthly_spending'
  | 'unknown';

export type DateRangePreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'year_to_date'
  | 'all_time'
  | 'custom';

export interface StructuredIntent {
  intent: IntentName;
  category?: string;
  categories?: string[];
  merchant?: string;
  dateRange: DateRangePreset;
  startDate?: string;
  endDate?: string;
  limit?: number;
}
