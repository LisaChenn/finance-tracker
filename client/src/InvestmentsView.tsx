import { useMemo, useState } from "react";
import type { AccountGroup, AnnotatedHolding, HoldingsGroup } from "./types";
import { formatCurrency, initials, titleCase } from "./lib/transactions";
import { Donut } from "./lib/charts";
import TabHeader, { type ViewName } from "./TabHeader";

interface Props {
  groups: HoldingsGroup[];
  accountGroups: AccountGroup[];
  lastSyncedLabel: string;
  loading: boolean;
  onRefresh: () => void;
  view: ViewName;
  onViewChange: (v: ViewName) => void;
}

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
  lastSyncedLabel,
  loading,
  onRefresh,
  view,
  onViewChange,
}: Props) {
  const [groupMode, setGroupMode] = useState<GroupMode>("security");

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
