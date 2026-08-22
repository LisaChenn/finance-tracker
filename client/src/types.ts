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
