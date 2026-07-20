export type CalculationPlanSource = 'previous_result' | 'previous_transactions' | 'transactions';

export type CalculationPlanOperation =
  | 'sum'
  | 'average'
  | 'median'
  | 'count'
  | 'top_n'
  | 'group_by'
  | 'list'
  | 'answer_from_previous_result'
  | 'derive_from_previous'
  | 'unknown';

export type CalculationPlanGroupBy =
  'merchant' | 'category' | 'merchant_category' | 'month' | 'month_category';

export type CalculationPlanMetric = 'amount' | 'expenses' | 'income' | 'cash_flow';

export interface CalculationPlanFilters {
  category?: string;
  categories?: string[];
  merchant?: string;
  excludeCategories?: string[];
}

export interface CalculationPlan {
  source: CalculationPlanSource;
  operation: CalculationPlanOperation;
  filters?: CalculationPlanFilters;
  groupBy?: CalculationPlanGroupBy;
  metric?: CalculationPlanMetric;
  limit?: number;
  divisor?: number;
  approximate?: boolean;
}
