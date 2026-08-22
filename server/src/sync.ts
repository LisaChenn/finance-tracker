import { plaidClient } from "./plaid";
import {
  applySyncPage,
  getItem,
  getItemCursor,
  getItems,
  setAccountsFetchedAt,
  setTransactionsFetchedAt,
  setTransactionsLastError,
  upsertAccounts,
} from "./store";

const inflightAccounts = new Map<string, Promise<void>>();
const inflightTransactions = new Map<string, Promise<void>>();

const PRODUCT_NOT_READY = "PRODUCT_NOT_READY";
const PRODUCT_NOT_READY_DELAYS_MS = [1000, 3000, 9000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plaidErrorCode(err: any): string | null {
  return err?.response?.data?.error_code ?? null;
}

async function refreshAccountsInternal(item_id: string): Promise<void> {
  const item = getItem(item_id);
  if (!item) return;
  try {
    const response = await plaidClient.accountsBalanceGet({
      access_token: item.access_token,
    });
    upsertAccounts(item_id, response.data.accounts);
    setAccountsFetchedAt(item_id, new Date().toISOString());
  } catch (err: any) {
    console.error(
      `[sync] refreshAccounts failed for ${item.institution_name}`,
      err?.response?.data || err
    );
  }
}

async function syncTransactionsInternal(item_id: string): Promise<void> {
  const item = getItem(item_id);
  if (!item) return;

  let attempt = 0;
  while (true) {
    try {
      let cursor = getItemCursor(item_id) ?? undefined;
      let hasMore = true;
      let added = 0;
      let modified = 0;
      let removed = 0;

      while (hasMore) {
        // Plaid call OUTSIDE db.transaction — db.transaction requires sync fn
        const response = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor,
          count: 500,
        });
        const { added: a, modified: m, removed: r, next_cursor, has_more } =
          response.data;
        applySyncPage(item_id, a as any, m as any, r as any, next_cursor);
        added += a.length;
        modified += m.length;
        removed += r.length;
        cursor = next_cursor;
        hasMore = has_more;
      }

      setTransactionsFetchedAt(item_id, new Date().toISOString());
      setTransactionsLastError(item_id, null);
      console.log(
        `[sync] ${item.institution_name}: +${added} ~${modified} -${removed}`
      );
      return;
    } catch (err: any) {
      const code = plaidErrorCode(err);
      if (
        code === PRODUCT_NOT_READY &&
        attempt < PRODUCT_NOT_READY_DELAYS_MS.length
      ) {
        const wait = PRODUCT_NOT_READY_DELAYS_MS[attempt];
        attempt++;
        console.log(
          `[sync] ${item.institution_name}: PRODUCT_NOT_READY, retry #${attempt} in ${wait}ms`
        );
        await sleep(wait);
        continue;
      }
      const msg = code ?? err?.message ?? String(err);
      console.error(
        `[sync] syncTransactions failed for ${item.institution_name}: ${msg}`,
        err?.response?.data || ""
      );
      setTransactionsLastError(item_id, msg);
      return;
    }
  }
}

export function scheduleRefreshAccounts(item_id: string): Promise<void> {
  const existing = inflightAccounts.get(item_id);
  if (existing) return existing;
  const p = refreshAccountsInternal(item_id).finally(() =>
    inflightAccounts.delete(item_id)
  );
  inflightAccounts.set(item_id, p);
  return p;
}

export function scheduleSyncTransactions(item_id: string): Promise<void> {
  const existing = inflightTransactions.get(item_id);
  if (existing) return existing;
  const p = syncTransactionsInternal(item_id).finally(() =>
    inflightTransactions.delete(item_id)
  );
  inflightTransactions.set(item_id, p);
  return p;
}

export function scheduleRefreshItem(item_id: string): Promise<void> {
  return Promise.all([
    scheduleRefreshAccounts(item_id),
    scheduleSyncTransactions(item_id),
  ]).then(() => undefined);
}

export function scheduleRefreshAll(): Promise<void> {
  return Promise.all(getItems().map((i) => scheduleRefreshItem(i.item_id))).then(
    () => undefined
  );
}
