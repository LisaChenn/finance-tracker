import { useMemo, useState } from "react";
import type { AccountGroup, AnnotatedTransaction } from "./types";
import {
  bucketOf,
  formatCurrency,
  groupByPrimaryCategory,
  initials,
  isIncome,
  isSpending,
  netWorthSparkline,
  titleCase,
  topMerchants,
} from "./lib/transactions";
import LinkButton from "./LinkButton";
import TxnTable from "./TxnTable";
import TabHeader, { type ViewName } from "./TabHeader";

const KNOWN_INSTITUTIONS = ["Chase", "Bank of America", "SoFi", "Fidelity"];

const CATEGORY_COLORS = [
  "#4d8dff",
  "rgba(242, 243, 245, 0.45)",
  "rgba(242, 243, 245, 0.2)",
  "rgba(77, 141, 255, 0.55)",
  "rgba(242, 243, 245, 0.3)",
];

interface Props {
  groups: AccountGroup[];
  txns: AnnotatedTransaction[];
  netWorth: number;
  start: string;
  end: string;
  linkedInstitutions: Set<string>;
  onLinked: () => void;
  view: ViewName;
  onViewChange: (v: ViewName) => void;
}

function Sparkline({ points }: { points: { value: number }[] }) {
  const w = 640;
  const h = 100;
  if (points.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h + 20}`} className="block w-full h-auto mt-4 max-w-[640px]" role="img" />;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const pts = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value - min) / span) * (h - 12) - 6;
      return `${x},${y}`;
    })
    .join(" ");
  const [first, ...rest] = pts.split(" ");
  const path = `M${first} L${rest.join(" L")}`;
  const fillPath = `${path} L${w},${h + 20} L0,${h + 20} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h + 20}`}
      className="block w-full h-auto mt-4 max-w-[640px]"
      role="img"
      aria-label="Net worth trend"
    >
      <defs>
        <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4d8dff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#4d8dff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#nwFill)" />
      <path
        d={path}
        fill="none"
        stroke="#4d8dff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Donut({
  buckets,
  total,
}: {
  buckets: { key: string; label: string; value: number }[];
  total: number;
}) {
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" className="shrink-0">
      <g transform="rotate(-90 75 75)" fill="none" strokeLinecap="round">
        <circle cx="75" cy="75" r={r} stroke="rgba(255,255,255,.06)" strokeWidth="11" />
        {buckets.map((b, i) => {
          const frac = total > 0 ? b.value / total : 0;
          const dash = frac * c;
          const el = (
            <circle
              key={b.key}
              cx="75"
              cy="75"
              r={r}
              stroke={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              strokeWidth="11"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </g>
      <text x="75" y="71" textAnchor="middle" fill="rgba(242,243,245,.4)" style={{ font: "500 9.5px Archivo", letterSpacing: "0.14em" }}>
        30 DAYS
      </text>
      <text x="75" y="90" textAnchor="middle" fill="#f2f3f5" style={{ font: "700 19px Archivo" }}>
        {formatCurrency(total, { max: 0 })}
      </text>
    </svg>
  );
}

function InstitutionMiniSpark({ up }: { up: boolean }) {
  const stroke = up ? "#4d8dff" : "rgba(242,243,245,.35)";
  const points = up ? "0,14 10,12 20,13 30,8 41,6 52,3" : "0,10 10,12 20,8 30,10 41,6 52,4";
  return (
    <svg width="52" height="18" viewBox="0 0 52 18">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

const CAPTION =
  "font-medium text-[11px] leading-none tracking-wider2 uppercase text-ink-faint m-0";
const PANEL = "bg-panel rounded-2xl px-6 py-[22px]";

export default function OverviewView({
  groups,
  txns,
  netWorth,
  start,
  end,
  linkedInstitutions,
  onLinked,
  view,
  onViewChange,
}: Props) {
  const spending = useMemo(() => txns.filter(isSpending), [txns]);
  const spend30 = spending.reduce((s, t) => s + t.amount, 0);

  const daySpan = Math.max(
    1,
    Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) /
        (1000 * 60 * 60 * 24)
    ) || 30
  );
  const dailyAvg = spend30 / daySpan;

  const categories = useMemo(() => {
    return groupByPrimaryCategory(spending).map((b) => ({
      key: b.primary,
      label: titleCase(b.primary),
      value: b.total,
      count: b.count,
    }));
  }, [spending]);
  const topCats = categories.slice(0, 3);

  const merchants = useMemo(() => topMerchants(spending, 6), [spending]);

  const creditDue = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      for (const a of g.accounts) {
        if (bucketOf(a) === "credit") sum += a.balances.current ?? 0;
      }
    }
    return sum;
  }, [groups]);

  const institutionRollups = useMemo(() => {
    return groups.map((g) => {
      const total = g.accounts.reduce(
        (s, a) => s + (a.balances.current ?? 0),
        0
      );
      let hint = "";
      const first = g.accounts[0];
      if (g.accounts.length > 1) hint = `${g.accounts.length} accounts`;
      else if (first) hint = titleCase(first.subtype ?? first.type ?? "");
      return {
        item_id: g.item_id,
        name: g.institution_name,
        total,
        hint,
        trendUp: total >= 0,
      };
    });
  }, [groups]);

  const unlinkedInstitutions = KNOWN_INSTITUTIONS.filter(
    (i) => !linkedInstitutions.has(i)
  );

  const sparkPoints = useMemo(
    () => netWorthSparkline(txns, netWorth, start, end, 30),
    [txns, netWorth, start, end]
  );

  const pctChange = useMemo(() => {
    if (sparkPoints.length < 2) return null;
    const first = sparkPoints[0].value;
    const last = sparkPoints[sparkPoints.length - 1].value;
    if (Math.abs(first) < 1) return null;
    return ((last - first) / Math.abs(first)) * 100;
  }, [sparkPoints]);

  const catShares = topCats.map((c) =>
    spend30 > 0 ? (c.value / spend30) * 100 : 0
  );

  const creditCardsCount = groups.reduce(
    (s, g) => s + g.accounts.filter((a) => bucketOf(a) === "credit").length,
    0
  );

  return (
    <div className="bg-card rounded-[20px] p-[26px] shadow-card">
      <TabHeader
        active={view}
        onChange={onViewChange}
        right={<span className="font-medium text-[11.5px] leading-none text-ink-faint">30 days</span>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3.5">
        {/* Net worth */}
        <div className={PANEL}>
          <p className={CAPTION}>Net worth</p>
          <div className="flex items-end gap-3 mt-2.5">
            <span className="font-bold text-[44px] leading-none tracking-tight tabular">
              {formatCurrency(netWorth)}
            </span>
            {pctChange !== null && (
              <span className="mb-1.5 font-semibold text-[12px] leading-none text-accent-text">
                {pctChange >= 0 ? "↑" : "↓"} {Math.abs(pctChange).toFixed(1)}%
              </span>
            )}
          </div>
          <Sparkline points={sparkPoints} />
        </div>

        {/* Right stack */}
        <div className="flex flex-col gap-3.5">
          <div className={PANEL}>
            <p className={CAPTION}>Spent · 30 days</p>
            <div className="flex items-baseline justify-between mt-2.5">
              <span className="font-bold text-[28px] leading-none tabular">
                {formatCurrency(spend30)}
              </span>
              <span className="font-medium text-[11.5px] leading-[1.4] text-ink-faint text-right">
                {formatCurrency(dailyAvg, { max: 2 })} / day
                <br />
                {spending.length} transactions
              </span>
            </div>
            <div className="flex gap-[3px] mt-4">
              {catShares.length === 0 ? (
                <span className="flex-1 rounded bg-white/[0.09] h-[26px]" />
              ) : (
                <>
                  {catShares.map((share, i) => (
                    <span
                      key={i}
                      className="rounded h-[26px]"
                      style={{
                        flex: `0 0 ${share}%`,
                        background: CATEGORY_COLORS[i],
                      }}
                    />
                  ))}
                  {catShares.reduce((s, x) => s + x, 0) < 100 && (
                    <span className="flex-1 rounded h-[26px] bg-white/[0.18]" />
                  )}
                </>
              )}
            </div>
          </div>

          <div className={`${PANEL} flex-1`}>
            <p className={CAPTION}>Credit due</p>
            <div className="flex items-baseline justify-between mt-2.5">
              <span className="font-bold text-[28px] leading-none tabular">
                {formatCurrency(creditDue)}
              </span>
              {creditDue > 0 && (
                <span className="font-semibold text-[11.5px] leading-none px-3 py-[7px] rounded-full bg-accent-soft text-accent-text">
                  Across {creditCardsCount} card{creditCardsCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.95fr_0.95fr] gap-3.5 mt-3.5">
        {/* Accounts */}
        <div className={PANEL}>
          <span className="font-semibold text-[13px] leading-none">Accounts</span>
          <div className="flex flex-col gap-3.5 mt-4">
            {institutionRollups.length === 0 && (
              <p className="font-medium text-[12px] leading-tight text-ink-fainter py-3">
                No accounts linked yet.
              </p>
            )}
            {institutionRollups.map((r) => (
              <div key={r.item_id} className="flex items-center gap-3">
                <span className="w-[30px] h-[30px] shrink-0 rounded-[9px] bg-white/[0.06] flex items-center justify-center font-semibold text-[11px] leading-none text-ink/65">
                  {initials(r.name)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-[12.5px] leading-tight truncate">
                    {r.name}
                  </span>
                  <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px]">
                    {r.hint}
                  </span>
                </span>
                <InstitutionMiniSpark up={r.trendUp} />
                <span className="font-semibold text-[12.5px] leading-tight tabular whitespace-nowrap">
                  {formatCurrency(r.total)}
                </span>
              </div>
            ))}
            {unlinkedInstitutions.slice(0, 1).map((name) => (
              <div
                key={name}
                className="pt-1.5 border-t border-line flex items-center justify-between"
              >
                <span className="font-medium text-[12px] leading-tight text-ink-faint">
                  {name}
                </span>
                <LinkButton
                  institutionName={name}
                  isLinked={false}
                  onLinked={onLinked}
                  variant="chip"
                  labelWhenUnlinked="Link"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className={PANEL}>
          <span className="font-semibold text-[13px] leading-none">Categories</span>
          <div className="flex items-center gap-4 mt-3">
            <Donut
              buckets={topCats}
              total={topCats.reduce((s, c) => s + c.value, 0)}
            />
            <div className="flex flex-col gap-3 min-w-0">
              {topCats.length === 0 && (
                <p className="font-medium text-[12px] leading-tight text-ink-fainter">
                  No spending yet.
                </p>
              )}
              {topCats.map((c, i) => (
                <div key={c.key} className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 shrink-0 rounded-[2px]"
                      style={{ background: CATEGORY_COLORS[i] }}
                    />
                    <span className="font-medium text-[12px] leading-none truncate">
                      {c.label}
                    </span>
                  </div>
                  <div className="font-semibold text-[12.5px] leading-none mt-[5px] ml-4 tabular">
                    {formatCurrency(c.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top merchants */}
        <div className={PANEL}>
          <span className="font-semibold text-[13px] leading-none">Top merchants</span>
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
      </div>

      <ActivitySection txns={txns} />
    </div>
  );
}

function ActivitySection({ txns }: { txns: AnnotatedTransaction[] }) {
  const [tab, setTab] = useState("all");
  const filtered = useMemo(() => {
    if (tab === "pending") return txns.filter((t) => t.pending);
    if (tab === "income") return txns.filter((t) => isIncome(t));
    return txns;
  }, [txns, tab]);
  return (
    <TxnTable
      txns={filtered}
      title="Activity"
      subtitle={`${filtered.length} transactions · last 30 days`}
      tabs={[
        { id: "all", label: "All" },
        { id: "pending", label: "Pending" },
        { id: "income", label: "Income" },
      ]}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}
