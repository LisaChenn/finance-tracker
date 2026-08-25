import { useEffect, useMemo, useState } from "react";
import type {
  AccountGroup,
  AnnotatedHolding,
  AssetBucket,
  DepositAllocation,
  DriftResponse,
  HoldingsGroup,
  UnclassifiedHolding,
} from "./types";
import { formatCurrency, initials, titleCase } from "./lib/transactions";
import { Donut } from "./lib/charts";
import TabHeader, { type ViewName } from "./TabHeader";

interface Props {
  groups: HoldingsGroup[];
  accountGroups: AccountGroup[];
  drift: DriftResponse | null;
  onTargetsChanged: () => void;
  lastSyncedLabel: string;
  loading: boolean;
  onRefresh: () => void;
  view: ViewName;
  onViewChange: (v: ViewName) => void;
}

const BUCKET_ORDER: AssetBucket[] = [
  "us_stocks",
  "intl_stocks",
  "bonds",
  "cash",
  "other",
];
const BUCKET_LABELS: Record<AssetBucket, string> = {
  us_stocks: "US Stocks",
  intl_stocks: "Intl Stocks",
  bonds: "Bonds",
  cash: "Cash",
  other: "Other",
};
// `other` is a holding pen for unclassified positions — not a bucket you set
// a target for. The editor lets you allocate across everything else.
type EditableBucket = Exclude<AssetBucket, "other">;
const EDITABLE_BUCKETS: EditableBucket[] = [
  "us_stocks",
  "intl_stocks",
  "bonds",
  "cash",
];
const DEFAULT_TARGETS: Record<EditableBucket, number> = {
  us_stocks: 60,
  intl_stocks: 20,
  bonds: 15,
  cash: 5,
};

const CAPTION =
  "font-medium text-[11px] leading-none tracking-wider2 uppercase text-ink-faint m-0";
const PANEL = "bg-panel rounded-2xl px-6 py-[22px]";

const TYPE_COLORS = [
  "#4d8dff",
  "rgba(242, 243, 245, 0.55)",
  "rgba(77, 141, 255, 0.55)",
  "rgba(242, 243, 245, 0.3)",
  "rgba(242, 243, 245, 0.18)",
  "rgba(77, 141, 255, 0.28)",
];

type GroupMode = "security" | "account";

function holdingValue(h: AnnotatedHolding): number {
  if (h.institution_value !== null && h.institution_value !== undefined)
    return h.institution_value;
  if (h.quantity !== null && h.institution_price !== null)
    return h.quantity * h.institution_price;
  return 0;
}

function normalizeType(t: string | null): string {
  if (!t) return "Other";
  const l = t.toLowerCase();
  if (l === "etf") return "ETF";
  if (l === "mutual fund") return "Mutual fund";
  return titleCase(l.replace(/\s+/g, "_"));
}

export default function InvestmentsView({
  groups,
  accountGroups,
  drift,
  onTargetsChanged,
  lastSyncedLabel,
  loading,
  onRefresh,
  view,
  onViewChange,
}: Props) {
  const [groupMode, setGroupMode] = useState<GroupMode>("security");
  const [editorOpen, setEditorOpen] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);

  const accountLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of accountGroups) {
      for (const a of g.accounts) {
        m.set(a.account_id, a.official_name ?? a.name);
      }
    }
    return m;
  }, [accountGroups]);

  const holdings = useMemo<AnnotatedHolding[]>(() => {
    const out: AnnotatedHolding[] = [];
    for (const g of groups) {
      for (const h of g.holdings) {
        out.push({
          ...h,
          institution_name: g.institution_name,
          account_name: accountLookup.get(h.account_id) ?? "Account",
        });
      }
    }
    return out;
  }, [groups, accountLookup]);

  const totalValue = useMemo(
    () => holdings.reduce((s, h) => s + holdingValue(h), 0),
    [holdings]
  );

  const totalCost = useMemo(() => {
    let anyCost = false;
    let sum = 0;
    for (const h of holdings) {
      if (h.cost_basis !== null && h.cost_basis !== undefined && h.quantity) {
        anyCost = true;
        sum += h.cost_basis * h.quantity;
      }
    }
    return anyCost ? sum : null;
  }, [holdings]);

  const unrealized = totalCost !== null ? totalValue - totalCost : null;

  const allocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      const key = normalizeType(h.security.type);
      map.set(key, (map.get(key) ?? 0) + holdingValue(h));
    }
    return [...map.entries()]
      .map(([label, value]) => ({ key: label, label, value }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const sortedHoldings = useMemo(
    () => [...holdings].sort((a, b) => holdingValue(b) - holdingValue(a)),
    [holdings]
  );

  const byAccount = useMemo(() => {
    const map = new Map<string, { name: string; holdings: AnnotatedHolding[] }>();
    for (const h of sortedHoldings) {
      const key = `${h.institution_name}::${h.account_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.holdings.push(h);
      } else {
        map.set(key, {
          name: `${h.institution_name} · ${h.account_name}`,
          holdings: [h],
        });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.holdings.reduce((s, h) => s + holdingValue(h), 0) -
        a.holdings.reduce((s, h) => s + holdingValue(h), 0)
    );
  }, [sortedHoldings]);

  const hasHoldings = holdings.length > 0;

  return (
    <div className="bg-card rounded-[20px] p-[26px] shadow-card">
      <TabHeader
        active={view}
        onChange={onViewChange}
        right={
          <>
            <span className="font-medium text-[11.5px] leading-none text-ink-faint">
              Synced {lastSyncedLabel}
            </span>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="font-medium text-[11.5px] leading-none px-[13px] py-2 rounded-full bg-white/5 text-ink/70 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-default"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </>
        }
      />

      {/* Summary panel */}
      <div className="bg-panel rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr] gap-6 items-center">
        <div>
          <p className={CAPTION}>Market value</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <span className="font-bold text-[40px] leading-none tracking-tight tabular">
              {formatCurrency(totalValue)}
            </span>
          </div>
          <p className="font-medium text-[11.5px] leading-tight text-ink-fainter mt-2">
            {holdings.length} position{holdings.length === 1 ? "" : "s"} across{" "}
            {groups.filter((g) => g.holdings.length > 0).length} institution
            {groups.filter((g) => g.holdings.length > 0).length === 1 ? "" : "s"}
          </p>
        </div>

        {unrealized !== null ? (
          <SummaryStat
            label="Unrealized gain"
            value={unrealized}
            hint={
              totalCost !== null
                ? `on ${formatCurrency(totalCost)} cost basis`
                : ""
            }
            signed
          />
        ) : (
          <SummaryStat
            label="Unrealized gain"
            value={0}
            hint="No cost basis reported"
            muted
          />
        )}

        <SummaryStat
          label="Largest position"
          value={
            sortedHoldings.length > 0 ? holdingValue(sortedHoldings[0]) : 0
          }
          hint={
            sortedHoldings.length > 0
              ? sortedHoldings[0].security.ticker_symbol ??
                sortedHoldings[0].security.name ??
                ""
              : ""
          }
        />
      </div>

      {/* Target allocation */}
      {hasHoldings && (
        <AllocationPanel
          drift={drift}
          onEdit={() => setEditorOpen(true)}
          onEditOverrides={() => setOverridesOpen(true)}
        />
      )}
      {editorOpen && (
        <TargetsEditor
          drift={drift}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            onTargetsChanged();
          }}
        />
      )}
      {overridesOpen && (
        <OverridesEditor
          drift={drift}
          onClose={() => setOverridesOpen(false)}
          onChanged={onTargetsChanged}
        />
      )}

      {/* Allocation + top positions */}
      {hasHoldings && (
        <div className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.15fr] gap-3.5 mt-3.5">
          <div className={PANEL}>
            <span className="font-semibold text-[13px] leading-none">
              Allocation
            </span>
            <div className="flex items-center gap-4 mt-3">
              <Donut
                buckets={allocation}
                total={totalValue}
                colors={TYPE_COLORS}
                centerLabel="TOTAL"
              />
              <div className="flex flex-col gap-3 min-w-0 flex-1">
                {allocation.map((a, i) => {
                  const pct = totalValue > 0 ? (a.value / totalValue) * 100 : 0;
                  return (
                    <div key={a.key} className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2 h-2 shrink-0 rounded-[2px]"
                          style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                        />
                        <span className="font-medium text-[12px] leading-none truncate">
                          {a.label}
                        </span>
                        <span className="ml-auto font-medium text-[11px] leading-none text-ink-fainter tabular">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="font-semibold text-[12.5px] leading-none mt-[5px] ml-4 tabular">
                        {formatCurrency(a.value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={PANEL}>
            <span className="font-semibold text-[13px] leading-none">
              Top positions
            </span>
            <div className="flex flex-col gap-[11px] mt-4">
              {sortedHoldings.slice(0, 6).map((h) => {
                const pct =
                  totalValue > 0 ? (holdingValue(h) / totalValue) * 100 : 0;
                const label =
                  h.security.ticker_symbol ?? h.security.name ?? "Position";
                return (
                  <div key={`${h.account_id}-${h.security_id}`} className="flex items-center gap-[11px]">
                    <span className="w-[26px] h-[26px] shrink-0 rounded-lg bg-white/[0.06] flex items-center justify-center font-semibold text-[10px] leading-none text-ink/60">
                      {initials(label)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-[12.5px] leading-tight truncate">
                        {label}
                      </span>
                      <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px] truncate">
                        {h.security.ticker_symbol && h.security.name
                          ? h.security.name
                          : h.institution_name}
                      </span>
                    </span>
                    <span className="font-medium text-[11px] leading-none text-ink-fainter tabular whitespace-nowrap">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="font-semibold text-[12.5px] leading-tight tabular whitespace-nowrap">
                      {formatCurrency(holdingValue(h))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Positions table */}
      {hasHoldings && (
        <div className={`${PANEL} mt-3.5`}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <span className="font-semibold text-[13px] leading-none">
              Positions
            </span>
            <div className="flex gap-1.5">
              {(["security", "account"] as const).map((mode) => {
                const isActive = groupMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={
                      "font-medium text-[11.5px] leading-none px-3 py-[7px] rounded-full transition-colors " +
                      (isActive
                        ? "bg-white/[0.07] text-ink"
                        : "text-ink-faint hover:text-ink")
                    }
                  >
                    {mode === "security" ? "By security" : "By account"}
                  </button>
                );
              })}
            </div>
          </div>

          <PositionsHeader />
          {groupMode === "security" ? (
            sortedHoldings.map((h) => (
              <PositionRow
                key={`${h.account_id}-${h.security_id}`}
                holding={h}
                totalValue={totalValue}
                showAccount
              />
            ))
          ) : (
            <>
              {byAccount.map((group) => {
                const subtotal = group.holdings.reduce(
                  (s, h) => s + holdingValue(h),
                  0
                );
                return (
                  <div key={group.name}>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-3.5 pt-4 pb-1 border-b border-white/[0.045]">
                      <span className="font-semibold text-[12px] leading-tight text-ink/80">
                        {group.name}
                      </span>
                      <span className="font-semibold text-[12px] leading-tight tabular whitespace-nowrap">
                        {formatCurrency(subtotal)}
                      </span>
                    </div>
                    {group.holdings.map((h) => (
                      <PositionRow
                        key={`${h.account_id}-${h.security_id}`}
                        holding={h}
                        totalValue={totalValue}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {!hasHoldings && (
        <div className={`${PANEL} mt-3.5`}>
          <p className="font-medium text-[12px] leading-tight text-ink-fainter">
            No investment holdings found yet. If you just linked an investment
            account, Plaid may still be pulling positions — refresh in a
            moment. Otherwise, link an investment institution (Fidelity,
            Schwab, etc.) from the Accounts tab.
          </p>
        </div>
      )}
    </div>
  );
}

const POS_COLS =
  "grid grid-cols-[70px_1fr_90px] sm:grid-cols-[90px_1fr_90px_100px_110px_110px] items-center gap-3.5";

function PositionsHeader() {
  return (
    <div
      className={`${POS_COLS} pt-3.5 pb-2 border-b border-white/[0.07] font-semibold text-[10px] leading-none tracking-[0.13em] uppercase text-ink-fainter`}
    >
      <span>Ticker</span>
      <span>Name</span>
      <span className="hidden sm:block text-right">Qty</span>
      <span className="hidden sm:block text-right">Price</span>
      <span className="hidden sm:block text-right">% Port.</span>
      <span className="text-right">Value</span>
    </div>
  );
}

function PositionRow({
  holding: h,
  totalValue,
  showAccount = false,
}: {
  holding: AnnotatedHolding;
  totalValue: number;
  showAccount?: boolean;
}) {
  const value = holdingValue(h);
  const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
  const ticker = h.security.ticker_symbol ?? "—";
  const name = h.security.name ?? "Position";
  const qty = h.quantity;
  const price = h.institution_price;
  return (
    <div className={`${POS_COLS} py-[11px] border-b border-white/[0.045]`}>
      <span className="font-semibold text-[12.5px] leading-tight tabular truncate">
        {ticker}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-[12.5px] leading-tight truncate">
          {name}
        </span>
        {showAccount && (
          <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px] truncate">
            {h.institution_name} · {h.account_name}
          </span>
        )}
      </span>
      <span className="hidden sm:block font-medium text-[12px] leading-tight text-ink-fainter text-right tabular">
        {qty !== null && qty !== undefined ? formatQuantity(qty) : "—"}
      </span>
      <span className="hidden sm:block font-medium text-[12px] leading-tight text-ink-fainter text-right tabular">
        {price !== null && price !== undefined
          ? formatCurrency(price, { max: 2 })
          : "—"}
      </span>
      <span className="hidden sm:block font-medium text-[12px] leading-tight text-ink-fainter text-right tabular">
        {pct.toFixed(1)}%
      </span>
      <span className="font-semibold text-[12.5px] leading-tight tabular whitespace-nowrap text-right">
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function formatQuantity(q: number): string {
  const abs = Math.abs(q);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return q.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function AllocationPanel({
  drift,
  onEdit,
  onEditOverrides,
}: {
  drift: DriftResponse | null;
  onEdit: () => void;
  onEditOverrides: () => void;
}) {
  if (!drift || drift.total_value <= 0) return null;

  const targetsByBucket = new Map<AssetBucket, number>();
  const currentByBucket = new Map<AssetBucket, number>();
  for (const b of drift.buckets) {
    currentByBucket.set(b.bucket, b.current_value);
    if (b.target_pct !== null) targetsByBucket.set(b.bucket, b.target_pct);
  }
  const hasTargets = targetsByBucket.size > 0;

  const rows = BUCKET_ORDER.map((bucket) => ({
    bucket,
    target: targetsByBucket.get(bucket) ?? 0,
    currentValue: currentByBucket.get(bucket) ?? 0,
  })).filter((r) => r.target > 0 || r.currentValue > 0);

  const unclassifiedCount = drift.unclassified.length;

  return (
    <div className={`${PANEL} mt-3.5`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-[13px] leading-none">
          Target allocation
        </span>
        <div className="flex items-center gap-3">
          <span className="font-medium text-[11px] leading-none text-ink-fainter tabular whitespace-nowrap">
            {formatCurrency(drift.total_value)} total
          </span>
          <button
            onClick={onEdit}
            className="font-medium text-[11.5px] leading-none px-[13px] py-2 rounded-full bg-white/5 text-ink/70 hover:bg-white/10 transition-colors"
          >
            {hasTargets ? "Edit targets" : "Set targets"}
          </button>
        </div>
      </div>

      {!hasTargets ? (
        <div className="mt-4 font-medium text-[12px] leading-[1.5] text-ink-fainter">
          Set a target allocation across US Stocks, Intl Stocks, Bonds, and
          Cash to see how far your portfolio has drifted — and how to bring it
          back with new contributions.
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 mt-4">
          {rows.map((r) => (
            <DriftRow
              key={r.bucket}
              bucket={r.bucket}
              target={r.target}
              currentValue={r.currentValue}
              totalValue={drift.total_value}
            />
          ))}
        </div>
      )}

      {hasTargets && <DepositSuggester />}

      {unclassifiedCount > 0 && (
        <button
          onClick={onEditOverrides}
          className="mt-4 pt-3.5 w-full text-left border-t border-white/[0.05] font-medium text-[11.5px] leading-tight text-ink-fainter hover:text-ink transition-colors"
        >
          {unclassifiedCount} holding{unclassifiedCount === 1 ? "" : "s"} need a
          bucket — classify them →
        </button>
      )}
      {unclassifiedCount === 0 && (
        <button
          onClick={onEditOverrides}
          className="mt-4 pt-3.5 w-full text-left border-t border-white/[0.05] font-medium text-[11.5px] leading-tight text-ink-fainter hover:text-ink transition-colors"
        >
          Manage bucket assignments →
        </button>
      )}
    </div>
  );
}

function DepositSuggester() {
  const [input, setInput] = useState("");
  const [allocations, setAllocations] = useState<DepositAllocation[] | null>(
    null
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the fetch so typing "1000" doesn't fire four requests. 350ms is
  // the sweet spot for a numeric input — long enough to catch multi-digit
  // typing, short enough to feel live.
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === "") {
      setAllocations(null);
      setAmount(null);
      setError(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setAllocations(null);
      setAmount(null);
      setError(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/allocation/drift?deposit=${n}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        const data = (await res.json()) as DriftResponse;
        setAllocations(data.suggest_deposit?.allocations ?? []);
        setAmount(data.suggest_deposit?.amount ?? n);
        setError(null);
      } catch (err: any) {
        setAllocations(null);
        setAmount(null);
        setError(err?.message ?? "Failed to compute");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [input]);

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.05]">
      <label className="flex items-center gap-3">
        <span className="font-medium text-[12px] leading-none text-ink/80 whitespace-nowrap">
          New deposit
        </span>
        <div className="flex items-center gap-1 flex-1">
          <span className="font-medium text-[12px] leading-none text-ink-fainter">
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            placeholder="0"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-[130px] text-right tabular font-semibold text-[13px] leading-none bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 focus:outline-none focus:border-white/20"
          />
        </div>
        {loading && (
          <span className="font-medium text-[10.5px] leading-none text-ink-fainter">
            …
          </span>
        )}
      </label>

      {error && (
        <div className="mt-3 font-medium text-[11.5px] leading-tight text-red-400">
          {error}
        </div>
      )}

      {allocations !== null && amount !== null && (
        <div className="mt-3">
          {allocations.length === 0 ? (
            <div className="font-medium text-[11.5px] leading-[1.5] text-ink-fainter">
              No suggestion — set targets first.
            </div>
          ) : (
            <>
              <div className="font-medium text-[10.5px] leading-none tracking-[0.13em] uppercase text-ink-fainter">
                Suggested buys
              </div>
              <div className="flex flex-col gap-1.5 mt-2.5">
                {allocations.map((a) => {
                  const pct = amount > 0 ? (a.buy / amount) * 100 : 0;
                  return (
                    <div
                      key={a.bucket}
                      className="flex items-baseline gap-3 text-[12px] leading-none"
                    >
                      <span className="font-medium flex-1 truncate">
                        {BUCKET_LABELS[a.bucket]}
                      </span>
                      <span className="font-medium text-[10.5px] text-ink-fainter tabular whitespace-nowrap">
                        {pct.toFixed(0)}%
                      </span>
                      <span className="font-semibold tabular whitespace-nowrap w-[76px] text-right">
                        {formatCurrency(a.buy)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TargetsEditor({
  drift,
  onClose,
  onSaved,
}: {
  drift: DriftResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Seed the editor from whatever's already set; if nothing is, seed a sane
  // 60/20/15/5 starting point so the user has something to tweak rather than
  // four empty inputs.
  const initial = useMemo<Record<EditableBucket, string>>(() => {
    const fromServer = new Map<AssetBucket, number>();
    if (drift) {
      for (const b of drift.buckets) {
        if (b.target_pct !== null) fromServer.set(b.bucket, b.target_pct);
      }
    }
    const hasAny = fromServer.size > 0;
    const seed = {} as Record<EditableBucket, string>;
    for (const b of EDITABLE_BUCKETS) {
      const v = hasAny ? fromServer.get(b) ?? 0 : DEFAULT_TARGETS[b];
      seed[b] = String(v);
    }
    return seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = EDITABLE_BUCKETS.map((b) => {
    const raw = values[b].trim();
    const n = raw === "" ? 0 : Number(raw);
    return { bucket: b, value: n, valid: Number.isFinite(n) && n >= 0 && n <= 100 };
  });
  const allValid = parsed.every((p) => p.valid);
  const sum = parsed.reduce((s, p) => s + p.value, 0);
  const sumOk = Math.abs(sum - 100) <= 0.01;
  const canSave = allValid && sumOk && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Only send buckets with a positive target — sending 0s would clutter
      // the DB with rows the user never intended to keep. Server still
      // validates the sum on non-empty submissions.
      const targets = parsed
        .filter((p) => p.value > 0)
        .map((p) => ({ bucket: p.bucket, target_pct: p.value }));
      const res = await fetch("/api/allocation/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Edit target allocation"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] bg-card rounded-2xl p-6 shadow-card"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-[15px] leading-none">
            Target allocation
          </span>
          <span
            className={
              "font-semibold text-[11px] leading-none tabular " +
              (sumOk ? "text-accent-text" : "text-red-400")
            }
          >
            {sum.toFixed(1)}% {sumOk ? "✓" : "/ 100%"}
          </span>
        </div>

        <div className="flex flex-col gap-3 mt-5">
          {EDITABLE_BUCKETS.map((b) => (
            <label key={b} className="flex items-center gap-3">
              <span className="font-medium text-[12.5px] leading-none flex-1">
                {BUCKET_LABELS[b]}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={1}
                value={values[b]}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [b]: e.target.value }))
                }
                className="w-[76px] text-right tabular font-semibold text-[13px] leading-none bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-2 focus:outline-none focus:border-white/20"
              />
              <span className="font-medium text-[12px] leading-none text-ink-fainter w-[10px]">
                %
              </span>
            </label>
          ))}
        </div>

        {error && (
          <div className="mt-4 font-medium text-[11.5px] leading-tight text-red-400">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="font-medium text-[12px] leading-none px-4 py-2 rounded-full text-ink/70 hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="font-semibold text-[12px] leading-none px-4 py-2 rounded-full bg-accent-text/90 text-black hover:bg-accent-text transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DriftRow({
  bucket,
  target,
  currentValue,
  totalValue,
}: {
  bucket: AssetBucket;
  target: number;
  currentValue: number;
  totalValue: number;
}) {
  const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
  const driftPct = currentPct - target;
  // ±2% counts as "on target" — normal fluctuation, no color noise.
  const isClose = Math.abs(driftPct) <= 2;
  const driftTone = isClose
    ? "text-ink-fainter"
    : driftPct > 0
      ? "text-red-400"
      : "text-accent-text";
  const driftSign = driftPct > 0 ? "+" : driftPct < 0 ? "−" : "";
  const driftMag = Math.abs(driftPct);

  const barPct = Math.max(0, Math.min(currentPct, 100));
  const markerPct = Math.max(0, Math.min(target, 100));

  return (
    <div>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-medium text-[12px] leading-none flex-1 truncate">
          {BUCKET_LABELS[bucket]}
        </span>
        <span className="font-medium text-[10.5px] leading-none text-ink-fainter tabular whitespace-nowrap">
          {currentPct.toFixed(1)}% / {target.toFixed(0)}%
        </span>
        <span
          className={`font-semibold text-[11px] leading-none tabular whitespace-nowrap w-[46px] text-right ${driftTone}`}
        >
          {driftSign}
          {driftMag.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 relative h-[6px] rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-white/25 rounded-full"
          style={{ width: `${barPct}%` }}
        />
        {target > 0 && (
          <div
            className="absolute inset-y-[-2px] w-[2px] bg-accent-text/80"
            style={{ left: `calc(${markerPct}% - 1px)` }}
          />
        )}
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  signed,
  muted,
}: {
  label: string;
  value: number;
  hint: string;
  signed?: boolean;
  muted?: boolean;
}) {
  const tone =
    muted || value === 0
      ? "text-ink"
      : value > 0
        ? "text-accent-text"
        : "text-red-400";
  return (
    <div className="min-w-0">
      <p className={CAPTION}>{label}</p>
      <div
        className={`font-bold text-[22px] leading-[1.1] mt-2 tabular ${tone}`}
      >
        {muted ? "—" : formatCurrency(value, { signed })}
      </div>
      {hint && (
        <div className="font-medium text-[11px] leading-tight text-ink-fainter mt-2 truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

interface StoredOverride {
  ticker_symbol: string;
  bucket: AssetBucket;
  updated_at: string;
}

function OverridesEditor({
  drift,
  onClose,
  onChanged,
}: {
  drift: DriftResponse | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [overrides, setOverrides] = useState<StoredOverride[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/allocation/overrides");
      const data = await res.json();
      setOverrides(data.overrides ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load overrides");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  async function setBucket(ticker: string, bucket: AssetBucket) {
    setBusy(ticker);
    setError(null);
    try {
      const res = await fetch("/api/allocation/override", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, bucket }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      await refresh();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function unsetBucket(ticker: string) {
    setBusy(ticker);
    setError(null);
    try {
      const res = await fetch(
        `/api/allocation/override/${encodeURIComponent(ticker)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      await refresh();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? "Failed to remove");
    } finally {
      setBusy(null);
    }
  }

  // "Needs a bucket" — from the current drift response; excludes anything
  // already overridden (drift already respected overrides when it computed).
  const unclassified: UnclassifiedHolding[] = drift?.unclassified ?? [];

  // Sort overrides largest-first isn't possible here (we don't know values
  // in this view), so sort alphabetically for stability.
  const sortedOverrides = [...overrides].sort((a, b) =>
    a.ticker_symbol.localeCompare(b.ticker_symbol)
  );

  const hasAnything = unclassified.length > 0 || sortedOverrides.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Bucket assignments"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] max-h-[85vh] overflow-y-auto bg-card rounded-2xl p-6 shadow-card"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-[15px] leading-none">
            Bucket assignments
          </span>
          <button
            onClick={onClose}
            className="font-medium text-[11.5px] leading-none px-3 py-1.5 rounded-full text-ink/70 hover:bg-white/5 transition-colors"
          >
            Done
          </button>
        </div>

        {!hasAnything && (
          <div className="mt-5 font-medium text-[12px] leading-[1.5] text-ink-fainter">
            No holdings need classification yet. As you link investment
            accounts, ETFs and mutual funds will appear here for you to tag.
          </div>
        )}

        {unclassified.length > 0 && (
          <section className="mt-5">
            <div className="font-semibold text-[10px] leading-none tracking-[0.13em] uppercase text-ink-fainter">
              Needs a bucket
            </div>
            <div className="flex flex-col gap-2 mt-3">
              {unclassified.map((h) => {
                const ticker = h.ticker_symbol ?? h.security_id;
                return (
                  <OverrideRow
                    key={h.security_id}
                    label={h.ticker_symbol ?? "—"}
                    sublabel={h.name ?? ""}
                    trailing={formatCurrency(h.value)}
                    value=""
                    busy={busy === ticker}
                    onSelect={(b) => setBucket(ticker, b)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {sortedOverrides.length > 0 && (
          <section className="mt-5">
            <div className="font-semibold text-[10px] leading-none tracking-[0.13em] uppercase text-ink-fainter">
              Already classified
            </div>
            <div className="flex flex-col gap-2 mt-3">
              {sortedOverrides.map((o) => (
                <OverrideRow
                  key={o.ticker_symbol}
                  label={o.ticker_symbol}
                  sublabel={BUCKET_LABELS[o.bucket]}
                  value={o.bucket}
                  busy={busy === o.ticker_symbol}
                  onSelect={(b) => setBucket(o.ticker_symbol, b)}
                  onRemove={() => unsetBucket(o.ticker_symbol)}
                />
              ))}
            </div>
          </section>
        )}

        {error && (
          <div className="mt-4 font-medium text-[11.5px] leading-tight text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function OverrideRow({
  label,
  sublabel,
  trailing,
  value,
  busy,
  onSelect,
  onRemove,
}: {
  label: string;
  sublabel: string;
  trailing?: string;
  value: AssetBucket | "";
  busy: boolean;
  onSelect: (b: AssetBucket) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[12.5px] leading-tight tabular truncate">
          {label}
        </div>
        {sublabel && (
          <div className="font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px] truncate">
            {sublabel}
          </div>
        )}
      </div>
      {trailing && (
        <span className="font-medium text-[11.5px] leading-none text-ink-fainter tabular whitespace-nowrap">
          {trailing}
        </span>
      )}
      <select
        value={value}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onSelect(v as AssetBucket);
        }}
        className="font-medium text-[12px] leading-none bg-white/[0.05] border border-white/[0.06] rounded-lg px-2 py-1.5 focus:outline-none focus:border-white/20 disabled:opacity-50"
      >
        {value === "" && <option value="">Choose bucket…</option>}
        {BUCKET_ORDER.map((b) => (
          <option key={b} value={b}>
            {BUCKET_LABELS[b]}
          </option>
        ))}
      </select>
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={busy}
          className="font-medium text-[10.5px] leading-none px-2 py-1.5 rounded text-ink-fainter hover:text-red-400 transition-colors disabled:opacity-50"
          aria-label={`Remove ${label} override`}
        >
          ×
        </button>
      )}
    </div>
  );
}
