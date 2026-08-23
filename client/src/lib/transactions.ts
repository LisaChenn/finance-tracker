import type {
  AnnotatedTransaction,
  DateRangePreset,
  PlaidAccount,
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

export function isIncome(txn: AnnotatedTransaction): boolean {
  if (txn.pending) return false;
  if (txn.personal_finance_category.primary === "INCOME") return true;
  return txn.amount < 0;
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
    const start = toLocalISODate(
      new Date(today.getFullYear(), today.getMonth(), 1)
    );
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

/* --- Account categorization --- */

export type AccountBucket = "cash" | "invested" | "credit" | "other";

export function bucketOf(account: PlaidAccount): AccountBucket {
  const type = (account.type ?? "").toLowerCase();
  const sub = (account.subtype ?? "").toLowerCase();
  if (type === "credit" || sub.includes("credit")) return "credit";
  if (type === "investment" || type === "brokerage") return "invested";
  if (type === "depository") return "cash";
  if (type === "loan") return "other";
  return "other";
}

/* --- Initials for avatars --- */

export function initials(name: string, max = 2): string {
  const parts = name.trim().split(/[\s&·]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, max).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, max);
}

/* --- Formatting --- */

export function formatCurrency(
  value: number | null | undefined,
  opts: { max?: number; signed?: boolean } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const s = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.max ?? 2,
  });
  if (opts.signed) {
    if (value > 0) return `+${s}`;
    if (value < 0) return `−${s}`;
  }
  return value < 0 ? `−${s}` : s;
}

export function formatShortMonthDay(iso: string): string {
  // Handle "YYYY-MM-DD" as local date to avoid TZ off-by-one
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* --- Monthly buckets for 12-month bar chart --- */

export interface MonthBucket {
  key: string; // YYYY-MM
  label: string; // e.g., "Aug"
  total: number;
  count: number;
  isCurrent: boolean;
  isPartial: boolean;
}

export function monthlySpendBuckets(
  txns: AnnotatedTransaction[],
  today: Date = new Date(),
  months = 12
): MonthBucket[] {
  // Build 12 rolling months, ending with the current month
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      total: 0,
      count: 0,
      isCurrent: i === 0,
      isPartial: i === 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const t of txns) {
    if (!isSpending(t)) continue;
    const key = t.date.slice(0, 7);
    const idx = index.get(key);
    if (idx === undefined) continue;
    buckets[idx].total += t.amount;
    buckets[idx].count += 1;
  }
  return buckets;
}

/* --- Recurring detection (simple: >=2 txns to the same merchant in range) --- */

export interface RecurringItem {
  merchant: string;
  count: number;
  cadence: string;
  latestAmount: number;
  totalAmount: number;
}

export function detectRecurring(
  txns: AnnotatedTransaction[]
): RecurringItem[] {
  const spend = txns.filter(isSpending);
  const map = new Map<string, AnnotatedTransaction[]>();
  for (const t of spend) {
    const key = t.merchant_name ?? t.name;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  const items: RecurringItem[] = [];
  for (const [merchant, arr] of map) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      const g = daysBetween(arr[i - 1].date, arr[i].date);
      if (g > 0) gaps.push(g);
    }
    const avg = gaps.length
      ? gaps.reduce((s, g) => s + g, 0) / gaps.length
      : 0;
    const cadence =
      arr.length >= 4 && avg > 0 && avg < 10
        ? `${arr.length}× · weekly`
        : arr.length >= 2 && avg >= 25 && avg <= 35
          ? "Monthly"
          : `${arr.length}× in range`;
    items.push({
      merchant,
      count: arr.length,
      cadence,
      latestAmount: arr[arr.length - 1].amount,
      totalAmount: arr.reduce((s, t) => s + t.amount, 0),
    });
  }
  return items.sort((a, b) => b.totalAmount - a.totalAmount);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

/* --- Sparkline points from txns (net cumulative delta over range) --- */

export interface SparkPoint {
  date: string;
  value: number;
}

export function netWorthSparkline(
  txns: AnnotatedTransaction[],
  currentNetWorth: number,
  start: string,
  end: string,
  steps = 30
): SparkPoint[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (!sy || !ey) return [];
  const startMs = new Date(sy, sm - 1, sd).getTime();
  const endMs = new Date(ey, em - 1, ed).getTime();
  const span = Math.max(endMs - startMs, 1);
  const stepMs = span / (steps - 1);

  // Build daily delta map: for spending, deduct; for income, add
  const deltas = new Map<string, number>();
  for (const t of txns) {
    if (t.pending) continue;
    // Plaid: positive = outflow. Net worth impact = -amount.
    const impact = -t.amount;
    deltas.set(t.date, (deltas.get(t.date) ?? 0) + impact);
  }

  // Compute point values by walking backwards from now (current net worth)
  // Point[i] = current - sum(deltas for dates AFTER samplePoint[i])
  const points: SparkPoint[] = [];
  const allDates = [...deltas.keys()].sort();
  const prefix: Array<{ date: string; cum: number }> = [];
  let cum = 0;
  for (const d of allDates) {
    cum += deltas.get(d) ?? 0;
    prefix.push({ date: d, cum });
  }
  const totalCum = cum;

  for (let i = 0; i < steps; i++) {
    const t = new Date(startMs + stepMs * i);
    const iso = toLocalISODate(t);
    // Sum of deltas up to iso (inclusive)
    let upto = 0;
    for (const p of prefix) {
      if (p.date <= iso) upto = p.cum;
      else break;
    }
    const value = currentNetWorth - (totalCum - upto);
    points.push({ date: iso, value });
  }
  return points;
}
