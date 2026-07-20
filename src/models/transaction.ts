export interface Transaction {
  date: Date;
  merchant: string;
  category: string;
  amount: number;
  account?: string;
}
