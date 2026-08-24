import { useMemo } from "react";
import type { AccountGroup, PlaidAccount } from "./types";
import {
  bucketOf,
  formatCurrency,
  initials,
  titleCase,
} from "./lib/transactions";
import LinkButton from "./LinkButton";
import TabHeader, { type ViewName } from "./TabHeader";

const KNOWN_INSTITUTIONS = ["Chase", "Bank of America", "SoFi", "Fidelity"];

interface Props {
  groups: AccountGroup[];
  netWorth: number;
  lastSyncedLabel: string;
  loading: boolean;
  onRefresh: () => void;
  linkedInstitutions: Set<string>;
  onLinked: () => void;
  view: ViewName;
  onViewChange: (v: ViewName) => void;
}

const CAPTION =
  "font-medium text-[11px] leading-none tracking-wider2 uppercase text-ink-faint m-0";

function formatMask(mask: string | null): string {
  if (!mask) return "";
  return `••${mask}`;
}

function accountLine(a: PlaidAccount): string {
  const type = titleCase(a.subtype ?? a.type ?? "");
  const mask = formatMask(a.mask);
  return [type, mask].filter(Boolean).join(" · ");
}

function FullAccountRow({ account: a }: { account: PlaidAccount }) {
  const bucket = bucketOf(a);
  const current = a.balances.current ?? 0;
  const limit = a.balances.limit;
  const available = a.balances.available;

  let utilNode: React.ReactNode = <span />;
  let midInfo: React.ReactNode = <span />;

  if (bucket === "credit" && limit && limit > 0) {
    const pct = Math.min(100, Math.max(0, (current / limit) * 100));
    utilNode = (
      <span>
        <span className="font-medium text-[11px] leading-none text-ink-fainter">
          {pct.toFixed(0)}% of {formatCurrency(limit, { max: 0 })}
        </span>
        <span className="block h-[3px] rounded-full bg-white/[0.08] mt-[7px] overflow-hidden">
          <span
            className="block h-[3px] rounded-full bg-accent"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
    );
    if (limit - current > 0) {
      midInfo = (
        <span className="font-medium text-[11.5px] leading-tight text-ink-fainter">
          {formatCurrency(limit - current, { max: 0 })} open to buy
        </span>
      );
    }
  } else {
    if (available !== null && available !== undefined) {
      midInfo = (
        <span className="font-medium text-[11.5px] leading-tight text-ink-fainter">
          {formatCurrency(available)} available
        </span>
      );
    }
    utilNode = (
      <span className="font-medium text-[11.5px] leading-tight text-ink-fainter">
        {titleCase(a.subtype ?? "")}
      </span>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_150px_130px_70px_120px] items-center gap-3.5 py-[11px] border-t border-line">
      <span className="min-w-0">
        <span className="block font-medium text-[12.5px] leading-tight truncate">
          {a.official_name ?? a.name}
        </span>
        <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px]">
          {accountLine(a)}
        </span>
      </span>
      <span className="hidden sm:block">{utilNode}</span>
      <span className="hidden sm:block">{midInfo}</span>
      <svg width="60" height="20" viewBox="0 0 60 20" className="hidden sm:block">
        <polyline
          points={
            bucket === "credit"
              ? "0,6 12,9 24,7 36,12 48,14 60,16"
              : "0,14 12,13 24,10 36,11 48,8 60,6"
          }
          fill="none"
          stroke={bucket === "credit" ? "rgba(242,243,245,.35)" : "#4d8dff"}
          strokeWidth="1.6"
        />
      </svg>
      <span className="font-semibold text-[13px] leading-tight text-right tabular whitespace-nowrap">
        {formatCurrency(current)}
      </span>
    </div>
  );
}

function SimpleAccountRow({ account: a }: { account: PlaidAccount }) {
  const current = a.balances.current ?? 0;
  const isInvested = bucketOf(a) === "invested";
  const inactive = current === 0;
  return (
    <div
      className={
        "grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_130px_100px] items-center gap-3 py-[11px] border-t border-line " +
        (inactive ? "opacity-55" : "")
      }
      style={inactive ? { opacity: 0.55 } : undefined}
    >
      <span className="min-w-0">
        <span className="block font-medium text-[12.5px] leading-tight truncate">
          {a.official_name ?? a.name}
        </span>
        <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px]">
          {accountLine(a)}
        </span>
      </span>
      <span
        className={
          "hidden sm:block font-medium text-[11.5px] leading-tight " +
          (isInvested ? "text-accent-text" : "text-ink-fainter")
        }
      >
        {isInvested ? "Investment" : inactive ? "No activity" : "Available"}
      </span>
      <span className="font-semibold text-[13px] leading-tight text-right tabular whitespace-nowrap">
        {formatCurrency(current)}
      </span>
    </div>
  );
}

function InstitutionCard({ group }: { group: AccountGroup }) {
  const total = group.accounts.reduce(
    (s, a) => s + (a.balances.current ?? 0),
    0
  );
  const hasCredit = group.accounts.some((a) => bucketOf(a) === "credit");
  return (
    <div className="bg-panel rounded-2xl px-6 py-[22px] mt-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 shrink-0 rounded-[10px] bg-white/[0.06] flex items-center justify-center font-semibold text-[11px] leading-none text-ink/65">
            {initials(group.institution_name)}
          </span>
          <span>
            <span className="block font-semibold text-[13.5px] leading-tight">
              {group.institution_name}
            </span>
            <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px]">
              {group.accounts.length} account
              {group.accounts.length === 1 ? "" : "s"}
            </span>
          </span>
        </div>
        <span className="font-bold text-[15px] leading-none tabular">
          {formatCurrency(total)}
        </span>
      </div>
      <div className="mt-4">
        {group.error && (
          <p className="text-red-400 font-medium text-[12px] leading-tight">
            {group.error}
          </p>
        )}
        {group.accounts.map((a) =>
          hasCredit ? (
            <FullAccountRow key={a.account_id} account={a} />
          ) : (
            <SimpleAccountRow key={a.account_id} account={a} />
          )
        )}
      </div>
    </div>
  );
}

export default function AccountsView({
  groups,
  netWorth,
  lastSyncedLabel,
  loading,
  onRefresh,
  linkedInstitutions,
  onLinked,
  view,
  onViewChange,
}: Props) {
  const totals = useMemo(() => {
    let cash = 0;
    let invested = 0;
    let credit = 0;
    let cashAccts = 0;
    let investedAccts = 0;
    let creditAccts = 0;
    let creditLimit = 0;
    for (const g of groups) {
      for (const a of g.accounts) {
        const bal = a.balances.current ?? 0;
        const b = bucketOf(a);
        if (b === "cash") {
          cash += bal;
          cashAccts++;
        } else if (b === "invested") {
          invested += bal;
          investedAccts++;
        } else if (b === "credit") {
          credit += bal;
          creditAccts++;
          creditLimit += a.balances.limit ?? 0;
        }
      }
    }
    return {
      cash,
      invested,
      credit,
      cashAccts,
      investedAccts,
      creditAccts,
      creditLimit,
    };
  }, [groups]);

  const total = totals.cash + totals.invested + Math.max(0, totals.credit);
  const cashPct = total > 0 ? (totals.cash / total) * 100 : 0;
  const investedPct = total > 0 ? (totals.invested / total) * 100 : 0;
  const creditPct =
    totals.creditLimit > 0 ? (totals.credit / totals.creditLimit) * 100 : 0;

  const unlinkedInstitutions = KNOWN_INSTITUTIONS.filter(
    (i) => !linkedInstitutions.has(i)
  );

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

      {/* Summary strip */}
      <div className="bg-panel rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr] gap-6 items-center">
        <div>
          <p className={CAPTION}>Net worth</p>
          <div className="flex items-end gap-2.5 mt-2.5">
            <span className="font-bold text-[40px] leading-none tracking-tight tabular">
              {formatCurrency(netWorth)}
            </span>
          </div>
          <svg width="240" height="42" viewBox="0 0 240 42" className="mt-3">
            <polyline
              points="0,34 22,31 44,28 66,30 88,22 110,18 132,15 154,12 176,11 198,7 219,4 240,2"
              fill="none"
              stroke="#4d8dff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <SummaryBlock
          label="Cash"
          value={totals.cash}
          barPct={cashPct}
          barClass="bg-accent"
          hint={`${totals.cashAccts} account${totals.cashAccts === 1 ? "" : "s"}`}
        />
        <SummaryBlock
          label="Invested"
          value={totals.invested}
          barPct={investedPct}
          barClass="bg-white/50"
          hint={`${totals.investedAccts} account${totals.investedAccts === 1 ? "" : "s"}`}
          action={
            totals.investedAccts > 0
              ? { label: "See positions →", onClick: () => onViewChange("investments") }
              : undefined
          }
        />
        <SummaryBlock
          label="Credit due"
          value={totals.credit}
          barPct={Math.min(100, creditPct)}
          barClass="bg-white/[0.28]"
          hint={
            totals.creditLimit > 0
              ? `${creditPct.toFixed(0)}% of ${formatCurrency(totals.creditLimit, { max: 0 })} limit`
              : `${totals.creditAccts} card${totals.creditAccts === 1 ? "" : "s"}`
          }
        />
      </div>

      {groups.length === 0 && (
        <div className="bg-panel rounded-2xl px-6 py-[22px] mt-3.5">
          <p className="font-medium text-[12px] leading-tight text-ink-fainter">
            No accounts linked yet. Use the link buttons below to add one.
          </p>
        </div>
      )}

      {groups.map((g) => (
        <InstitutionCard key={g.item_id} group={g} />
      ))}

      {unlinkedInstitutions.map((name) => (
        <div
          key={name}
          className="bg-white/[0.025] rounded-2xl px-6 py-5 mt-3.5 flex items-center justify-between gap-3 flex-wrap"
        >
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 shrink-0 rounded-[10px] bg-white/[0.05] flex items-center justify-center font-semibold text-[13px] leading-none text-ink-faint">
              +
            </span>
            <span>
              <span className="block font-semibold text-[13px] leading-tight text-ink/70">
                {name}
              </span>
              <span className="block font-medium text-[11px] leading-[1.4] text-ink-fainter mt-[3px]">
                Not linked · balances and transactions missing from totals
              </span>
            </span>
          </div>
          <LinkButton
            institutionName={name}
            isLinked={false}
            onLinked={onLinked}
            variant="solid"
            labelWhenUnlinked="Link account"
          />
        </div>
      ))}
    </div>
  );
}

function SummaryBlock({
  label,
  value,
  barPct,
  barClass,
  hint,
  action,
}: {
  label: string;
  value: number;
  barPct: number;
  barClass: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="min-w-0">
      <p className={CAPTION}>{label}</p>
      <div className="font-bold text-[22px] leading-[1.1] mt-2 tabular">
        {formatCurrency(value)}
      </div>
      <div className="h-[3px] rounded-full bg-white/[0.08] mt-3 overflow-hidden">
        <span
          className={`block h-[3px] rounded-full ${barClass}`}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="font-medium text-[11px] leading-none text-ink-fainter">
          {hint}
        </span>
        {action && (
          <button
            onClick={action.onClick}
            className="font-medium text-[11px] leading-none text-accent-text hover:text-ink transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
