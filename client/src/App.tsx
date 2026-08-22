import { useCallback, useEffect, useState } from "react";
import LinkButton from "./LinkButton";
import type { AccountGroup, LinkedItem } from "./types";

const INSTITUTIONS = ["Chase", "Bank of America", "SoFi", "Fidelity"];

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function App() {
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [linkedInstitutions, setLinkedInstitutions] = useState<Set<string>>(new Set());

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setGroups(data.groups ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to fetch accounts", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/items");
      const data = await res.json();
      const items: LinkedItem[] = data.items ?? [];
      setLinkedInstitutions(new Set(items.map((item) => item.institution_name)));
    } catch (err) {
      console.error("Failed to fetch items", err);
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  useEffect(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  const netWorth = groups.reduce((total, group) => {
    const groupTotal = group.accounts.reduce(
      (sum, account) => sum + (account.balances.current ?? 0),
      0
    );
    return total + groupTotal;
  }, 0);

  return (
    <div className="app">
      <header className="header">
        <h1>Finance Dashboard</h1>
        <div className="net-worth">
          <span className="net-worth-label">Total Net Worth</span>
          <span className="net-worth-value">{formatCurrency(netWorth)}</span>
        </div>
      </header>

      <div className="actions">
        {INSTITUTIONS.map((institution) => (
          <LinkButton
            key={institution}
            institutionName={institution}
            isLinked={linkedInstitutions.has(institution)}
            onLinked={refreshAll}
          />
        ))}
        <button className="refresh-button" onClick={refreshAll} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {lastUpdated && (
        <p className="last-updated">Last updated: {lastUpdated.toLocaleTimeString()}</p>
      )}

      <div className="account-groups">
        {groups.length === 0 && !loading && (
          <p className="empty-state">No accounts linked yet. Use the buttons above to get started.</p>
        )}
        {groups.map((group) => (
          <div className="card" key={group.item_id}>
            <h2>{group.institution_name}</h2>
            {group.error && <p className="error">{group.error}</p>}
            <ul className="account-list">
              {group.accounts.map((account) => (
                <li key={account.account_id} className="account-row">
                  <div className="account-info">
                    <span className="account-name">{account.name}</span>
                    <span className="account-subtype">{account.subtype ?? account.type}</span>
                  </div>
                  <span className="account-balance">
                    {formatCurrency(account.balances.current)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
