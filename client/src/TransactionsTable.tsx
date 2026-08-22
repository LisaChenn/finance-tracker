import { useMemo, useState } from "react";
import type { AnnotatedTransaction } from "./types";
import { titleCase } from "./lib/transactions";

const ROW_CAP = 500;

interface Props {
  txns: AnnotatedTransaction[];
  allAccounts: Array<{ account_id: string; name: string }>;
  accountFilter: Set<string>;
  onAccountFilterChange: (next: Set<string>) => void;
  search: string;
  onSearchChange: (next: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (next: string) => void;
  categoryOptions: string[];
}

function formatAmount(value: number): string {
  return Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function TransactionsTable({
  txns,
  allAccounts,
  accountFilter,
  onAccountFilterChange,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  categoryOptions,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const visible = useMemo(() => {
    return showAll ? txns : txns.slice(0, ROW_CAP);
  }, [txns, showAll]);

  const toggleAccount = (id: string) => {
    const next = new Set(accountFilter);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onAccountFilterChange(next);
  };

  return (
    <div className="card txn-card">
      <h2>Transactions</h2>

      <div className="txn-filters">
        <input
          className="txn-search"
          type="search"
          placeholder="Search description or merchant…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <select
          className="txn-category-select"
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="txn-account-chips">
        {allAccounts.map((a) => {
          const active = accountFilter.size === 0 || accountFilter.has(a.account_id);
          return (
            <button
              key={a.account_id}
              className={`link-button txn-chip${active ? " txn-chip-active" : ""}`}
              onClick={() => toggleAccount(a.account_id)}
              title={a.name}
            >
              {a.name}
            </button>
          );
        })}
        {accountFilter.size > 0 && (
          <button
            className="link-button txn-chip-clear"
            onClick={() => onAccountFilterChange(new Set())}
          >
            Clear
          </button>
        )}
      </div>

      {txns.length === 0 ? (
        <p className="empty-state">No transactions match these filters.</p>
      ) : (
        <>
          <div className="txn-table-wrap">
            <table className="txn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="txn-amount-col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const outflow = t.amount > 0;
                  const amountClass = t.pending
                    ? "amount-pending"
                    : outflow
                      ? "amount-out"
                      : "amount-in";
                  return (
                    <tr key={t.transaction_id}>
                      <td className="txn-date">{t.date}</td>
                      <td>
                        <div className="txn-name">
                          {t.merchant_name ?? t.name}
                        </div>
                        {t.pending && (
                          <div className="txn-pending-flag">Pending</div>
                        )}
                      </td>
                      <td>
                        <div className="txn-cat-primary">
                          {titleCase(t.personal_finance_category.primary)}
                        </div>
                        <div className="txn-cat-detailed">
                          {titleCase(t.personal_finance_category.detailed)}
                        </div>
                      </td>
                      <td className="txn-account">
                        <div>{t.account_name}</div>
                        <div className="txn-institution">
                          {t.institution_name}
                        </div>
                      </td>
                      <td className={`txn-amount-col ${amountClass}`}>
                        {outflow ? "-" : "+"}
                        {formatAmount(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!showAll && txns.length > ROW_CAP && (
            <button
              className="link-button txn-show-more"
              onClick={() => setShowAll(true)}
            >
              Show all {txns.length} rows
            </button>
          )}
        </>
      )}
    </div>
  );
}
