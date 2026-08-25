import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotatedTransaction,
  DateRangePreset,
  TransactionsResponse,
} from "./types";
import {
  computeDateRange,
  detectRecurring,
  flattenGroups,
  formatCurrency,
  groupByPrimaryCategory,
  initials,
  isIncome,
  isSpending,
  monthlySpendBuckets,
  titleCase,
  topMerchants,
  type MonthBucket,
} from "./lib/transactions";
import { useSyncPoller } from "./lib/useSyncPoller";
import TabHeader, { type ViewName } from "./TabHeader";
import TxnTable from "./TxnTable";

interface AccountEntry {
  account_id: string;
  name: string;
  institution_name: string;
}

interface Props {
  accounts: AccountEntry[];
  view: ViewName;
  onViewChange: (v: ViewName) => void;
}

const PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "MTD", label: "MTD" },
  { id: "YTD", label: "YTD" },
];

const CATEGORY_BAR_CLASSES = [
  "bg-accent",
  "bg-white/[0.42]",
  "bg-white/20",
];

const CAPTION =
  "font-medium text-[11px] leading-none tracking-wider2 uppercase text-ink-faint m-0";
const PANEL = "bg-panel rounded-2xl px-6 py-[22px]";

export default function SpendingView({
  accounts,
  view,
  onViewChange,
}: Props) {
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillPrimary, setDrillPrimary] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilterId, setAccountFilterId] = useState<string>("");

  const cacheRef = useRef<Map<string, TransactionsResponse>>(new Map());
  const historyRef = useRef<Map<string, TransactionsResponse>>(new Map());
  const [history, setHistory] = useState<TransactionsResponse | null>(null);

  const { start, end } = useMemo(
    () => computeDateRange(preset, new Date()),
    [preset]
  );
  const rangeKey = `${start}|${end}`;

  const fetchRange = useCallback(
    (
      s: string,
      e: string,
      refresh: boolean,
      cache: Map<string, TransactionsResponse>,
      onOk: (json: TransactionsResponse) => void
    ) => {
      let cancelled = false;
      const url = refresh
        ? `/api/transactions?start=${s}&end=${e}&refresh=1`
        : `/api/transactions?start=${s}&end=${e}`;
      fetch(url)
        .then((r) => r.json())
        .then((json: TransactionsResponse) => {
          if (cancelled) return;
          cache.set(`${s}|${e}`, json);
          onOk(json);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Failed to fetch transactions", err);
          setError("Failed to fetch transactions");
        });
      return () => {
        cancelled = true;
      };
    },
    []
  );

  const txnsPoller = useSyncPoller({
    field: "transactions_fetched_at",
    onBump: () => {
      cacheRef.current.delete(rangeKey);
      setLoading(true);
      fetchRange(start, end, false, cacheRef.current, (json) => {
        setData(json);
        setLoading(false);
      });
    },
  });

  useEffect(() => {
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      setData(cached);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
      fetchRange(start, end, true, cacheRef.current, (json) => {
        setData(json);
        setLoading(false);
      });
      txnsPoller.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, start, end]);

  useEffect(() => {
    const today = new Date();
    const histStart = new Date(today.getFullYear() - 1, today.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const histEnd = today.toISOString().slice(0, 10);
    const key = `${histStart}|${histEnd}`;
    const cached = historyRef.current.get(key);
    if (cached) {
      setHistory(cached);
      return;
    }
    fetchRange(histStart, histEnd, false, historyRef.current, (json) => {
      setHistory(json);
    });
  }, [fetchRange]);

  const accountLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_id, a.name);
    return m;
  }, [accounts]);

  const allTxns = useMemo<AnnotatedTransaction[]>(() => {
    if (!data) return [];
    return flattenGroups(data.groups, accountLookup).sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
  }, [data, accountLookup]);

  const historyTxns = useMemo<AnnotatedTransaction[]>(() => {
    if (!history) return [];
    return flattenGroups(history.groups, accountLookup);
  }, [history, accountLookup]);

  const spending = useMemo(() => allTxns.filter(isSpending), [allTxns]);
  const income = useMemo(() => allTxns.filter(isIncome), [allTxns]);

  const spendTotal = spending.reduce((s, t) => s + t.amount, 0);
  const incomeTotal = income.reduce((s, t) => s + Math.abs(t.amount), 0);
  const kept = incomeTotal - spendTotal;
  const keptPct = incomeTotal > 0 ? (kept / incomeTotal) * 100 : 0;
  const spendPctOfIncome =
    incomeTotal > 0 ? (spendTotal / incomeTotal) * 100 : 0;

  const monthly = useMemo(
    () => monthlySpendBuckets(historyTxns.length > 0 ? historyTxns : allTxns),
    [historyTxns, allTxns]
  );
  const maxMonth = Math.max(...monthly.map((m) => m.total), 1);
  const monthlyAvg =
    monthly.filter((m) => !m.isCurrent).reduce((s, m) => s + m.total, 0) /
      Math.max(1, monthly.length - 1) || 0;

  const categories = useMemo(
    () =>
      groupByPrimaryCategory(spending).map((b) => ({
        key: b.primary,
        label: titleCase(b.primary),
        value: b.total,
        count: b.count,
        share: spendTotal > 0 ? (b.total / spendTotal) * 100 : 0,
      })),
    [spending, spendTotal]
  );

  const merchants = useMemo(() => topMerchants(spending, 6), [spending]);
  const recurring = useMemo(
    () => detectRecurring(allTxns).slice(0, 4),
    [allTxns]
  );

  const categoryOptions = useMemo(
    () =>
      [...new Set(allTxns.map((t) => t.personal_finance_category.primary))].sort(),
    [allTxns]
  );

  const filteredTxns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTxns.filter((t) => {
      if (accountFilterId && t.account_id !== accountFilterId) return false;
      if (
        categoryFilter &&
        t.personal_finance_category.primary !== categoryFilter
      )
        return false;
      if (drillPrimary && t.personal_finance_category.primary !== drillPrimary)
        return false;
      if (q) {
        const hay = (t.merchant_name ?? t.name).toLowerCase();
        if (!hay.includes(q) && !t.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allTxns, accountFilterId, categoryFilter, drillPrimary, search]);

  return (
    <div className="bg-card rounded-[20px] p-[26px] shadow-card">
      <TabHeader
        active={view}
        onChange={onViewChange}
        right={
          <>
            <div className="flex gap-0.5 p-0.5 rounded-full bg-white/5">
              {PRESETS.map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPreset(p.id)}
                    className={
                      "text-[12px] leading-none px-3.5 py-2 rounded-full transition-colors " +
                      (active
                        ? "font-semibold bg-white/10 text-ink"
                        : "font-medium text-ink-faint hover:text-ink")
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span className="font-medium text-[11.5px] leading-none text-ink-faint whitespace-nowrap">
              {start} → {end}
              {loading && " · loading…"}
            </span>
          </>
        }
      />

      {error && (
        <p className="text-red-400 font-medium text-[12px] leading-tight">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5">
        {/* Bars */}
        <div className={PANEL}>
          <div className="flex items-baseline justify-between">
            <div>
              <p className={CAPTION}>Spent · this range</p>
              <div className="font-bold text-[32px] leading-none mt-2.5 tabular">
                {formatCurrency(spendTotal)}
              </div>
            </div>
            {monthlyAvg > 0 && (
              <span className="font-medium text-[11.5px] leading-[1.5] text-ink-faint text-right">
                Monthly average {formatCurrency(monthlyAvg, { max: 0 })}
                <br />
                {monthly[monthly.length - 1]?.total < monthlyAvg
                  ? `Tracking ${(((monthlyAvg - (monthly[monthly.length - 1]?.total ?? 0)) / monthlyAvg) * 100).toFixed(0)}% under`
                  : "Tracking on pace"}
              </span>
            )}
          </div>
          <MonthlyBars monthly={monthly} maxMonth={maxMonth} />
        </div>

        {/* Income vs spend */}
        <div className={PANEL}>
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-[13px] leading-none">
              Income vs spend
            </span>
            <span className="font-medium text-[11px] leading-none text-ink-fainter">
              This range
            </span>
          </div>
          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-[12px] leading-none text-ink-muted">
                Income
              </span>
              <span className="font-semibold text-[13px] leading-none tabular">
                {formatCurrency(incomeTotal)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.07] mt-2.5 overflow-hidden">
              <span
                className="block h-2 rounded-full bg-accent"
                style={{ width: `${incomeTotal > 0 ? 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-[12px] leading-none text-ink-muted">
                Spent
              </span>
              <span className="font-semibold text-[13px] leading-none tabular">
                {formatCurrency(spendTotal)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.07] mt-2.5 overflow-hidden">
              <span
                className="block h-2 rounded-full bg-white/[0.42]"
                style={{ width: `${Math.min(100, spendPctOfIncome)}%` }}
              />
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-line flex items-baseline justify-between">
            <span className="font-semibold text-[12.5px] leading-none">Kept</span>
            <span className="font-bold text-[20px] leading-none text-accent-text tabular">
              {formatCurrency(kept)}
            </span>
          </div>
          <div className="font-medium text-[11px] leading-[1.5] text-ink-fainter mt-2">
            {incomeTotal > 0
              ? `${keptPct.toFixed(0)}% of income`
              : "No income captured in this range"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 mt-3.5">
        {/* Categories */}
        <div className={PANEL}>
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-[13px] leading-none">
              Categories
            </span>
            <span className="font-medium text-[10.5px] leading-none text-ink-fainter">
              Click to drill in
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-1.5">
            {categories.length === 0 && (
              <p className="font-medium text-[12px] leading-tight text-ink-fainter">
                No spending in this range.
              </p>
            )}
            {categories.slice(0, 4).map((c, i) => {
              const active = drillPrimary === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    setDrillPrimary(active ? null : c.key)
                  }
                  className={
                    "text-left w-auto cursor-pointer -mx-3 px-3 py-2.5 rounded-xl transition-colors " +
                    (active
                      ? "bg-accent/[0.08]"
                      : "hover:bg-white/[0.04]")
                  }
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-[12.5px] leading-tight">
                      {c.label}
                    </span>
                    <span className="font-semibold text-[12.5px] leading-tight tabular">
                      {formatCurrency(c.value)}
                    </span>
                  </div>
                  <div className="h-[5px] rounded-full bg-white/[0.07] mt-2.5 overflow-hidden">
                    <span
                      className={`block h-[5px] rounded-full ${CATEGORY_BAR_CLASSES[i] ?? "bg-white/20"}`}
                      style={{ width: `${c.share}%` }}
                    />
                  </div>
                  <div className="font-medium text-[10.5px] leading-none text-ink-fainter mt-[7px]">
                    {c.count} txn{c.count === 1 ? "" : "s"} · {c.share.toFixed(1)}%
                  </div>
                </button>
              );
            })}
          </div>
          {drillPrimary && (
            <div className="font-medium text-[11px] leading-none text-ink-fainter mt-2.5 flex items-center gap-2">
              Filtered by{" "}
              <strong className="text-ink">{titleCase(drillPrimary)}</strong>
              <button
                type="button"
                onClick={() => setDrillPrimary(null)}
                className="font-medium text-[11px] leading-none px-2.5 py-1 rounded-full bg-white/5 text-ink/70 hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Top merchants */}
        <div className={PANEL}>
          <span className="font-semibold text-[13px] leading-none">
            Top merchants
          </span>
          <div className="flex flex-col gap-[11px] mt-4">
            {merchants.length === 0 && (
              <p className="font-medium text-[12px] leading-tight text-ink-fainter">
                No merchants yet.
              </p>
            )}
            {merchants.map((m) => (
              <div key={m.merchant} className="flex items-center gap-[11px]">
                <span className="w-[26px] h-[26px] shrink-0 rounded-lg bg-white/[0.06] flex items-center justify-center font-semibold text-[10px] leading-none text-ink/60">
                  {initials(m.merchant)}
                </span>
                <span className="flex-1 font-medium text-[12.5px] leading-tight truncate">
                  {m.merchant}
                  {m.count > 1 ? ` · ${m.count}` : ""}
                </span>
                <span className="font-semibold text-[12.5px] leading-tight tabular whitespace-nowrap">
                  {formatCurrency(m.total)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recurring */}
        <div className={PANEL}>
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-[13px] leading-none">
              Recurring
            </span>
            <span className="font-medium text-[10.5px] leading-none text-ink-fainter">
              Detected from repeats
            </span>
          </div>
          <div className="mt-4">
            {recurring.length === 0 ? (
              <p className="font-medium text-[12px] leading-tight text-ink-fainter">
                No recurring merchants detected in this range.
              </p>
            ) : (
              recurring.map((r) => (
                <div
                  key={r.merchant}
                  className="flex items-center justify-between py-2 border-b border-white/[0.05] gap-3 last:border-b-0"
                >
                  <span>
                    <span className="block font-medium text-[12.5px] leading-tight">
                      {r.merchant}
                    </span>
                    <span className="block font-medium text-[10.5px] leading-[1.4] text-ink/34 mt-[3px]">
                      {r.cadence}
                    </span>
                  </span>
                  <span className="font-semibold text-[12.5px] leading-tight tabular">
                    {formatCurrency(r.totalAmount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <TxnTable
        txns={filteredTxns}
        title="Transactions"
        subtitle={`${filteredTxns.length} transactions`}
        filters={
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="font-medium text-[11.5px] leading-none px-3.5 py-2 rounded-full border-0 bg-white/5 text-ink min-w-[180px] placeholder:text-ink-faint focus:outline-none focus:bg-white/[0.08]"
              type="search"
              placeholder="Search merchant…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="font-medium text-[11.5px] leading-none px-3.5 py-2 rounded-full border-0 bg-white/5 text-ink/70 cursor-pointer select-caret focus:outline-none"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </select>
            <select
              className="font-medium text-[11.5px] leading-none px-3.5 py-2 rounded-full border-0 bg-white/5 text-ink/70 cursor-pointer select-caret focus:outline-none"
              value={accountFilterId}
              onChange={(e) => setAccountFilterId(e.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        }
      />
    </div>
  );
}

function MonthlyBars({
  monthly,
  maxMonth,
}: {
  monthly: MonthBucket[];
  maxMonth: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hovered = hoverIdx !== null ? monthly[hoverIdx] : null;
  const tipPct =
    hoverIdx !== null ? ((hoverIdx + 0.5) / monthly.length) * 100 : 0;
  const tipTransform =
    tipPct < 12
      ? "translateX(0%)"
      : tipPct > 88
        ? "translateX(-100%)"
        : "translateX(-50%)";

  return (
    <div
      className="relative flex items-end gap-2.5 h-[120px] mt-5"
      onPointerLeave={() => setHoverIdx(null)}
    >
      {monthly.map((m, i) => {
        const h = Math.max(6, (m.total / maxMonth) * 108);
        const isHovered = hoverIdx === i;
        const dimmed = hoverIdx !== null && !isHovered;
        const barColor = m.isCurrent
          ? "bg-accent/35"
          : m.isPartial
            ? "bg-accent"
            : "bg-white/[0.09]";
        const labelActive = m.isCurrent || m.total > 0;
        return (
          <div
            key={m.key}
            className="flex-1 flex flex-col items-center gap-2 min-w-0 cursor-pointer"
            onPointerEnter={() => setHoverIdx(i)}
          >
            <div
              className={`w-full rounded ${barColor}`}
              style={{
                height: `${h}px`,
                opacity: dimmed ? 0.5 : 1,
                transition: "opacity 120ms",
              }}
            />
            <span
              className={
                "font-medium text-[10px] leading-none " +
                (isHovered
                  ? "text-ink"
                  : labelActive
                    ? "text-ink-muted"
                    : "text-ink-ghost")
              }
            >
              {m.label}
            </span>
          </div>
        );
      })}
      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 z-10 rounded-lg bg-black/85 px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{
            left: `${tipPct}%`,
            transform: tipTransform,
          }}
        >
          <div className="font-medium text-[10px] leading-none uppercase tracking-wider2 text-ink-faint">
            {hovered.label}
            {hovered.isCurrent ? " · so far" : ""}
          </div>
          <div className="font-semibold text-[12.5px] leading-none tabular text-ink mt-1">
            {formatCurrency(hovered.total)}
          </div>
          <div className="font-medium text-[10px] leading-none text-ink-fainter mt-1">
            {hovered.count} txn{hovered.count === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
