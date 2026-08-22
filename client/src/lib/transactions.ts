import type {
  AnnotatedTransaction,
  DateRangePreset,
  PlaidTransaction,
  TransactionGroup,
} from "../types";

const NON_SPENDING_PRIMARIES = new Set([
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
]);

export function isSpending(txn: AnnotatedTransaction): boolean {
  if (txn.pending) return false;
  if (txn.amount <= 0) return false;
  return !NON_SPENDING_PRIMARIES.has(txn.personal_finance_category.primary);
}

function toLocalISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function computeDateRange(
  preset: DateRangePreset,
  today: Date = new Date(),
  custom?: { start: string; end: string }
): { start: string; end: string } {
  const end = toLocalISODate(today);
  if (preset === "custom" && custom?.start && custom?.end) {
    return { start: custom.start, end: custom.end };
  }
  if (preset === "MTD") {
    const start = toLocalISODate(new Date(today.getFullYear(), today.getMonth(), 1));
    return { start, end };
  }
  if (preset === "YTD") {
    const start = toLocalISODate(new Date(today.getFullYear(), 0, 1));
    return { start, end };
  }
  const days = preset === "90d" ? 90 : 30;
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days);
  return { start: toLocalISODate(startDate), end };
}

export interface CategoryBucket {
  primary: string;
  total: number;
  count: number;
}

export function groupByPrimaryCategory(
  txns: AnnotatedTransaction[]
): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const t of txns) {
    const key = t.personal_finance_category.primary;
    const existing = map.get(key) ?? { primary: key, total: 0, count: 0 };
    existing.total += t.amount;
    existing.count += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface DetailedBucket {
  primary: string;
  detailed: string;
  total: number;
  count: number;
}

export function groupByDetailed(
  txns: AnnotatedTransaction[],
  primary: string
): DetailedBucket[] {
  const map = new Map<string, DetailedBucket>();
  for (const t of txns) {
    if (t.personal_finance_category.primary !== primary) continue;
    const key = t.personal_finance_category.detailed;
    const existing = map.get(key) ?? {
      primary,
      detailed: key,
      total: 0,
      count: 0,
    };
    existing.total += t.amount;
    existing.count += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface MerchantBucket {
  merchant: string;
  total: number;
  count: number;
}

export function topMerchants(
  txns: AnnotatedTransaction[],
  n = 10
): MerchantBucket[] {
  const map = new Map<string, MerchantBucket>();
  for (const t of txns) {
    const key = t.merchant_name ?? t.name;
    const existing = map.get(key) ?? { merchant: key, total: 0, count: 0 };
    existing.total += t.amount;
    existing.count += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

function normalizeCategory(txn: PlaidTransaction) {
  if (txn.personal_finance_category) return txn.personal_finance_category;
  const legacy = txn.category?.[0];
  if (legacy) {
    const upper = legacy.toUpperCase().replace(/\s+/g, "_");
    return { primary: upper, detailed: upper };
  }
  return { primary: "UNCATEGORIZED", detailed: "UNCATEGORIZED" };
}

export function flattenGroups(
  groups: TransactionGroup[],
  accountLookup: Map<string, string>
): AnnotatedTransaction[] {
  const out: AnnotatedTransaction[] = [];
  for (const g of groups) {
    for (const t of g.transactions ?? []) {
      out.push({
        ...t,
        institution_name: g.institution_name,
        account_name: accountLookup.get(t.account_id) ?? "Unknown account",
        personal_finance_category: normalizeCategory(t),
      });
    }
  }
  return out;
}

export function titleCase(snake: string): string {
  return snake
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
