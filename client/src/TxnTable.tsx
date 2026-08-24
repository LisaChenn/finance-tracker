import { useMemo, useState } from "react";
import type { AnnotatedTransaction } from "./types";
import {
  formatCurrency,
  formatShortMonthDay,
  titleCase,
} from "./lib/transactions";

const PAGE_SIZE = 15;

interface Props {
  txns: AnnotatedTransaction[];
  filters?: React.ReactNode;
  title?: string;
  subtitle?: string;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
}

const GRID_COLS =
  "grid grid-cols-[70px_1fr_90px] sm:grid-cols-[96px_1fr_210px_150px_110px] items-center gap-3.5";

export default function TxnTable({
  txns,
  filters,
  title = "Activity",
  subtitle,
  tabs,
  activeTab,
  onTabChange,
}: Props) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(txns.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => txns.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE),
    [txns, clampedPage]
  );

  const from = txns.length === 0 ? 0 : clampedPage * PAGE_SIZE + 1;
  const to = Math.min(txns.length, (clampedPage + 1) * PAGE_SIZE);

  const pageNums: number[] = [];
  const maxNumbers = Math.min(5, pageCount);
  let startNum = Math.max(0, clampedPage - 2);
  if (startNum + maxNumbers > pageCount) {
    startNum = Math.max(0, pageCount - maxNumbers);
  }
  for (let i = 0; i < maxNumbers; i++) pageNums.push(startNum + i);

  return (
    <div className="bg-panel rounded-2xl px-6 pt-[22px] pb-4 mt-3.5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-2.5">
          <span className="font-semibold text-[13px] leading-none">{title}</span>
          {subtitle && (
            <span className="font-medium text-[11.5px] leading-none text-ink-fainter">
              {subtitle}
            </span>
          )}
        </div>
        {tabs && tabs.length > 0 ? (
          <div className="flex gap-1.5 flex-wrap">
            {tabs.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => onTabChange?.(t.id)}
                  className={
                    "font-medium text-[11.5px] leading-none px-3 py-[7px] rounded-full transition-colors " +
                    (isActive
                      ? "bg-white/[0.07] text-ink"
                      : "text-ink-faint hover:text-ink")
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : (
          filters
        )}
      </div>

      <div
        className={`${GRID_COLS} pt-3.5 pb-2 border-b border-white/[0.07] font-semibold text-[10px] leading-none tracking-[0.13em] uppercase text-ink-fainter`}
      >
        <span>Date ↓</span>
        <span>Merchant</span>
        <span className="hidden sm:block">Category</span>
        <span className="hidden sm:block">Account</span>
        <span className="text-right">Amount</span>
      </div>

      {rows.length === 0 ? (
        <p className="font-medium text-[12px] leading-tight text-ink-fainter py-3">
          No transactions match these filters.
        </p>
      ) : (
        rows.map((t) => {
          const outflow = t.amount > 0;
          return (
            <div
              key={t.transaction_id}
              className={`${GRID_COLS} py-[11px] border-b border-white/[0.045]`}
            >
              <span className="font-medium text-[12px] leading-tight text-ink/45 tabular">
                {formatShortMonthDay(t.date)}
              </span>
              <span className="font-semibold text-[12.5px] leading-tight min-w-0 truncate">
                {t.merchant_name ?? t.name}
                {t.pending && (
                  <span className="ml-1.5 font-semibold text-[10px] leading-none px-[7px] py-[3px] rounded-full bg-accent-soft text-accent-text">
                    Pending
                  </span>
                )}
              </span>
              <span className="hidden sm:block font-medium text-[12px] leading-tight text-ink-fainter truncate">
                {titleCase(t.personal_finance_category.primary)}
                {t.personal_finance_category.detailed &&
                  t.personal_finance_category.detailed !==
                    t.personal_finance_category.primary &&
                  ` · ${titleCase(t.personal_finance_category.detailed.replace(`${t.personal_finance_category.primary}_`, ""))}`}
              </span>
              <span className="hidden sm:block font-medium text-[12px] leading-tight text-ink-fainter truncate">
                {t.account_name}
              </span>
              <span
                className={
                  "font-semibold text-[12.5px] leading-tight text-right tabular whitespace-nowrap " +
                  (outflow ? "text-ink" : "text-accent-text")
                }
              >
                {outflow ? "−" : "+"}
                {formatCurrency(Math.abs(t.amount))}
              </span>
            </div>
          );
        })
      )}

      <div className="flex items-center justify-between pt-3.5">
        <span className="font-medium text-[11.5px] leading-none text-ink-fainter">
          {txns.length === 0
            ? "Showing 0 of 0"
            : `Showing ${from}–${to} of ${txns.length}`}
        </span>
        <div className="flex items-center gap-1.5">
          <PagerButton
            disabled={clampedPage === 0}
            onClick={() => setPage(Math.max(0, clampedPage - 1))}
            arrow
          >
            ←
          </PagerButton>
          {pageNums.map((n) => (
            <PagerButton
              key={n}
              current={n === clampedPage}
              onClick={() => setPage(n)}
            >
              {n + 1}
            </PagerButton>
          ))}
          <PagerButton
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, clampedPage + 1))}
            arrow
          >
            →
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  disabled,
  current,
  arrow,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  current?: boolean;
  arrow?: boolean;
  onClick?: () => void;
}) {
  const base =
    "font-medium text-[12px] leading-none min-w-[30px] h-[30px] px-2 rounded-lg transition-colors";
  let variant = "text-ink-faint hover:text-ink";
  if (current) {
    variant = "font-semibold bg-accent-soft text-accent-text";
  } else if (disabled) {
    variant = "bg-white/[0.06] text-ink/25 cursor-default";
  } else if (arrow) {
    variant = "bg-white/[0.06] text-ink/70 hover:bg-white/[0.1]";
  }
  return (
    <button
      className={`${base} ${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
