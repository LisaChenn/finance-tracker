export interface PlaidBalance {
  available: number | null;
  current: number | null;
  limit: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balances: PlaidBalance;
}

export interface AccountGroup {
  institution_name: string;
  item_id: string;
  accounts: PlaidAccount[];
  error?: string;
}

export interface LinkedItem {
  item_id: string;
  institution_name: string;
  linked_at: string;
}

export interface PlaidPersonalFinanceCategory {
  primary: string;
  detailed: string;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  personal_finance_category: PlaidPersonalFinanceCategory | null;
  category: string[] | null;
  payment_channel: string | null;
}

export interface TransactionGroup {
  institution_name: string;
  item_id: string;
  transactions: PlaidTransaction[];
  error?: string;
}

export interface TransactionsResponse {
  start: string;
  end: string;
  groups: TransactionGroup[];
}

export type DateRangePreset = "30d" | "90d" | "MTD" | "YTD" | "custom";

export interface AnnotatedTransaction extends PlaidTransaction {
  institution_name: string;
  account_name: string;
  personal_finance_category: PlaidPersonalFinanceCategory;
}

export interface Security {
  ticker_symbol: string | null;
  name: string | null;
  type: string | null;
  close_price: number | null;
  close_price_as_of: string | null;
  iso_currency_code: string | null;
}

export interface Holding {
  account_id: string;
  security_id: string;
  quantity: number | null;
  institution_price: number | null;
  institution_value: number | null;
  cost_basis: number | null;
  iso_currency_code: string | null;
  security: Security;
}

export interface HoldingsGroup {
  institution_name: string;
  item_id: string;
  holdings: Holding[];
  fetched_at: string | null;
  stale_reason?: string;
}

export interface InvestmentsResponse {
  groups: HoldingsGroup[];
}

export interface AnnotatedHolding extends Holding {
  institution_name: string;
  account_name: string;
}

export type AssetBucket =
  | "us_stocks"
  | "intl_stocks"
  | "bonds"
  | "cash"
  | "other";

export interface DriftBucket {
  bucket: AssetBucket;
  target_pct: number | null;
  current_value: number;
  current_pct: number;
  drift_pct: number | null;
  drift_value: number | null;
}

export interface UnclassifiedHolding {
  security_id: string;
  ticker_symbol: string | null;
  name: string | null;
  value: number;
}

export interface DepositAllocation {
  bucket: AssetBucket;
  buy: number;
}

export interface DriftResponse {
  total_value: number;
  buckets: DriftBucket[];
  unclassified: UnclassifiedHolding[];
  suggest_deposit?: {
    amount: number;
    allocations: DepositAllocation[];
  };
}
