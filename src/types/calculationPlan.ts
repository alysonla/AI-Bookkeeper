export type CalculationPlanSource = 'previous_result' | 'previous_transactions' | 'transactions';

export type CalculationPlanOperation =
  | 'sum'
  | 'average'
  | 'median'
  | 'count'
  | 'top_n'
  | 'group_by'
  | 'list'
  | 'derive_from_previous'
  | 'unknown';

export type CalculationPlanGroupBy = 'merchant' | 'category' | 'merchant_category' | 'month';

export type CalculationPlanMetric = 'amount' | 'expenses' | 'income' | 'cash_flow';

export interface CalculationPlanFilters {
  category?: string;
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
