import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OverviewView from "./OverviewView";
import AccountsView from "./AccountsView";
import SpendingView from "./SpendingView";
import { useSyncPoller } from "./lib/useSyncPoller";
import type {
  AccountGroup,
  AnnotatedTransaction,
  LinkedItem,
  TransactionsResponse,
} from "./types";
import { computeDateRange, flattenGroups } from "./lib/transactions";
import type { ViewName } from "./TabHeader";

export default function App() {
  const [view, setView] = useState<ViewName>("overview");
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [linkedInstitutions, setLinkedInstitutions] = useState<Set<string>>(
    new Set()
  );

  // Shared 30-day transactions window (for Overview)
  const [txnData, setTxnData] = useState<TransactionsResponse | null>(null);
  const txnCacheRef = useRef<Map<string, TransactionsResponse>>(new Map());

  const { start, end } = useMemo(() => computeDateRange("30d", new Date()), []);
  const rangeKey = `${start}|${end}`;

  const fetchAccounts = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const url = refresh ? "/api/accounts?refresh=1" : "/api/accounts";
      const res = await fetch(url);
      const data = await res.json();
      setGroups(data.groups ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to fetch accounts", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOverviewTxns = useCallback(
    async (refresh = false) => {
      try {
        const url = refresh
          ? `/api/transactions?start=${start}&end=${end}&refresh=1`
          : `/api/transactions?start=${start}&end=${end}`;
        const res = await fetch(url);
        const data = (await res.json()) as TransactionsResponse;
        txnCacheRef.current.set(rangeKey, data);
        setTxnData(data);
      } catch (err) {
        console.error("Failed to fetch overview transactions", err);
      }
    },
    [start, end, rangeKey]
  );

  const accountsPoller = useSyncPoller({
    field: "accounts_fetched_at",
    onBump: () => {
      fetchAccounts(false);
    },
  });

  const overviewTxnsPoller = useSyncPoller({
    field: "transactions_fetched_at",
    onBump: () => {
      txnCacheRef.current.delete(rangeKey);
      fetchOverviewTxns(false);
    },
  });

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
    fetchAccounts(true);
    fetchItems();
    fetchOverviewTxns(true);
    accountsPoller.start();
    overviewTxnsPoller.start();
  }, [
    fetchAccounts,
    fetchItems,
    fetchOverviewTxns,
    accountsPoller,
    overviewTxnsPoller,
  ]);

  useEffect(() => {
    fetchAccounts(true);
    fetchItems();
    fetchOverviewTxns(true);
    accountsPoller.start();
    overviewTxnsPoller.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const netWorth = useMemo(
    () =>
      groups.reduce(
        (total, group) =>
          total +
          group.accounts.reduce(
            (sum, a) =>
              // Credit balances reduce net worth
              sum +
              ((a.type === "credit" ? -1 : 1) * (a.balances.current ?? 0)),
            0
          ),
        0
      ),
    [groups]
  );

  const flatAccounts = useMemo(
    () =>
      groups.flatMap((g) =>
        g.accounts.map((a) => ({
          account_id: a.account_id,
          name: a.name,
          institution_name: g.institution_name,
        }))
      ),
    [groups]
  );

  const accountLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of flatAccounts) m.set(a.account_id, a.name);
    return m;
  }, [flatAccounts]);

  const overviewTxns = useMemo<AnnotatedTransaction[]>(() => {
    if (!txnData) return [];
    return flattenGroups(txnData.groups, accountLookup).sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
  }, [txnData, accountLookup]);

  const lastSyncedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "…";

  return (
    <div className="max-w-[1240px] mx-auto px-5 pt-8 pb-16">
      {view === "overview" && (
        <OverviewView
          groups={groups}
          txns={overviewTxns}
          netWorth={netWorth}
          start={start}
          end={end}
          linkedInstitutions={linkedInstitutions}
          onLinked={refreshAll}
          view={view}
          onViewChange={setView}
        />
      )}
      {view === "accounts" && (
        <AccountsView
          groups={groups}
          netWorth={netWorth}
          lastSyncedLabel={lastSyncedLabel}
          loading={loading || accountsPoller.active}
          onRefresh={refreshAll}
          linkedInstitutions={linkedInstitutions}
          onLinked={refreshAll}
          view={view}
          onViewChange={setView}
        />
      )}
      {view === "spending" && (
        <SpendingView
          accounts={flatAccounts}
          view={view}
          onViewChange={setView}
        />
      )}
    </div>
  );
}
