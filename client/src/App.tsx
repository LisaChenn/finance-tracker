import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OverviewView from "./OverviewView";
import AccountsView from "./AccountsView";
import SpendingView from "./SpendingView";
import InvestmentsView from "./InvestmentsView";
import { useSyncPoller } from "./lib/useSyncPoller";
import type {
  AccountGroup,
  AnnotatedTransaction,
  DriftResponse,
  HoldingsGroup,
  InvestmentsResponse,
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

  const [investmentsGroups, setInvestmentsGroups] = useState<HoldingsGroup[]>(
    []
  );
  const [drift, setDrift] = useState<DriftResponse | null>(null);

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

  const fetchInvestments = useCallback(async (refresh = false) => {
    try {
      const url = refresh ? "/api/investments?refresh=1" : "/api/investments";
      const res = await fetch(url);
      const data = (await res.json()) as InvestmentsResponse;
      setInvestmentsGroups(data.groups ?? []);
    } catch (err) {
      console.error("Failed to fetch investments", err);
    }
  }, []);

  const fetchDrift = useCallback(async () => {
    try {
      const res = await fetch("/api/allocation/drift");
      const data = (await res.json()) as DriftResponse;
      setDrift(data);
    } catch (err) {
      console.error("Failed to fetch drift", err);
    }
  }, []);

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

  const investmentsPoller = useSyncPoller({
    field: "investments_fetched_at",
    onBump: () => {
      fetchInvestments(false);
      fetchDrift();
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
    fetchInvestments(true);
    fetchDrift();
    accountsPoller.start();
    overviewTxnsPoller.start();
    investmentsPoller.start();
  }, [
    fetchAccounts,
    fetchItems,
    fetchOverviewTxns,
    fetchInvestments,
    fetchDrift,
    accountsPoller,
    overviewTxnsPoller,
    investmentsPoller,
  ]);

  useEffect(() => {
    fetchAccounts(true);
    fetchItems();
    fetchOverviewTxns(true);
    fetchInvestments(true);
    fetchDrift();
    accountsPoller.start();
    overviewTxnsPoller.start();
    investmentsPoller.start();
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
      {view === "investments" && (
        <InvestmentsView
          groups={investmentsGroups}
          accountGroups={groups}
          drift={drift}
          onTargetsChanged={fetchDrift}
          lastSyncedLabel={lastSyncedLabel}
          loading={loading || investmentsPoller.active}
          onRefresh={refreshAll}
          view={view}
          onViewChange={setView}
        />
      )}
    </div>
  );
}
