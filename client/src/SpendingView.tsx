import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnnotatedTransaction,
  DateRangePreset,
  TransactionsResponse,
} from "./types";
import {
  computeDateRange,
  flattenGroups,
  isSpending,
  titleCase,
  topMerchants,
} from "./lib/transactions";
import { useSyncPoller } from "./lib/useSyncPoller";
import CategoryChart from "./CategoryChart";
import TransactionsTable from "./TransactionsTable";

interface AccountEntry {
  account_id: string;
  name: string;
  institution_name: string;
}

interface Props {
  accounts: AccountEntry[];
}

const PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "MTD", label: "MTD" },
  { id: "YTD", label: "YTD" },
  { id: "custom", label: "Custom" },
];

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function SpendingView({ accounts }: Props) {
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [accountFilter, setAccountFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [drillPrimary, setDrillPrimary] = useState<string | null>(null);

  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<string, TransactionsResponse>>(new Map());

  const { start, end } = useMemo(
    () =>
      computeDateRange(preset, new Date(), {
        start: customStart,
        end: customEnd,
      }),
    [preset, customStart, customEnd]
  );

  const rangeKey = `${start}|${end}`;

  const fetchRange = useCallback(
    (s: string, e: string, refresh: boolean) => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      const url = refresh
        ? `/api/transactions?start=${s}&end=${e}&refresh=1`
        : `/api/transactions?start=${s}&end=${e}`;
      fetch(url)
        .then((r) => r.json())
        .then((json: TransactionsResponse) => {
          if (cancelled) return;
          cacheRef.current.set(`${s}|${e}`, json);
          setData(json);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Failed to fetch transactions", err);
          setError("Failed to fetch transactions");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
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
      // Invalidate current range so the fetch pulls fresh rows
      cacheRef.current.delete(rangeKey);
      fetchRange(start, end, false);
    },
  });

  useEffect(() => {
    if (preset === "custom" && (!customStart || !customEnd)) return;
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }
    const cancel = fetchRange(start, end, true);
    txnsPoller.start();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, preset, customStart, customEnd, start, end]);

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

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTxns) set.add(t.personal_finance_category.primary);
    return [...set].sort();
  }, [allTxns]);

  const filteredTxns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTxns.filter((t) => {
      if (accountFilter.size > 0 && !accountFilter.has(t.account_id))
        return false;
      if (categoryFilter && t.personal_finance_category.primary !== categoryFilter)
        return false;
      if (drillPrimary && t.personal_finance_category.primary !== drillPrimary)
        return false;
      if (q) {
        const hay = (t.merchant_name ?? t.name).toLowerCase();
        if (!hay.includes(q) && !t.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allTxns, accountFilter, categoryFilter, drillPrimary, search]);

  const spendingTxns = useMemo(
    () => filteredTxns.filter(isSpending),
    [filteredTxns]
  );

  const merchants = useMemo(() => topMerchants(spendingTxns, 10), [spendingTxns]);

  return (
    <div className="spending-view">
      <div className="range-picker card">
        <div className="range-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`link-button${preset === p.id ? " link-button-linked" : ""}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="range-custom">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span>→</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
        )}
        <div className="range-summary">
          {start} → {end}
          {loading && <span className="range-loading"> · loading…</span>}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="spending-top">
        <CategoryChart
          txns={filteredTxns}
          drillPrimary={drillPrimary}
          onDrill={setDrillPrimary}
        />
        <div className="card top-merchants-card">
          <h2>Top merchants</h2>
          {merchants.length === 0 ? (
            <p className="empty-state">No spending yet.</p>
          ) : (
            <ul className="top-merchants">
              {merchants.map((m) => (
                <li key={m.merchant}>
                  <div className="merchant-info">
                    <span className="merchant-name">{m.merchant}</span>
                    <span className="merchant-count">
                      {m.count} txn{m.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="merchant-total">
                    {formatCurrency(m.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <TransactionsTable
        txns={filteredTxns}
        allAccounts={accounts}
        accountFilter={accountFilter}
        onAccountFilterChange={setAccountFilter}
        search={search}
        onSearchChange={setSearch}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        categoryOptions={categoryOptions}
      />

      {drillPrimary && (
        <p className="drill-hint">
          Filtered to <strong>{titleCase(drillPrimary)}</strong>.{" "}
          <button
            className="link-button drill-clear"
            onClick={() => setDrillPrimary(null)}
          >
            Clear
          </button>
        </p>
      )}
    </div>
  );
}
