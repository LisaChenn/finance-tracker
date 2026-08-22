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
