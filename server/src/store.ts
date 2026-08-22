import { db } from "./db";

export interface StoredItem {
  access_token: string;
  item_id: string;
  institution_name: string;
  linked_at: string;
}

export interface SyncMeta {
  item_id: string;
  accounts_fetched_at: string | null;
  transactions_fetched_at: string | null;
  transactions_last_error: string | null;
}

export interface StoredAccount {
  account_id: string;
  item_id: string;
  name: string | null;
  official_name: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  currency: string | null;
  balance_current: number | null;
  balance_available: number | null;
  balance_limit: number | null;
  updated_at: string;
}

export interface StoredTransaction {
  transaction_id: string;
  item_id: string;
  account_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  currency: string | null;
  pending: number;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  payment_channel: string | null;
  raw_json: string;
  updated_at: string;
}

// --- Items ---

const selectAllItems = db.prepare(
  `SELECT item_id, access_token, institution_name, linked_at FROM items`
);
const selectItem = db.prepare(
  `SELECT item_id, access_token, institution_name, linked_at FROM items WHERE item_id = ?`
);
const insertItemStmt = db.prepare(
  `INSERT INTO items (item_id, access_token, institution_name, linked_at) VALUES (?, ?, ?, ?)`
);
const updateItemStmt = db.prepare(
  `UPDATE items SET access_token = ?, institution_name = ?, linked_at = ? WHERE item_id = ?`
);
const clearCursorStmt = db.prepare(
  `UPDATE items SET transactions_cursor = NULL WHERE item_id = ?`
);
const insertSyncMetaStmt = db.prepare(
  `INSERT OR IGNORE INTO sync_meta (item_id) VALUES (?)`
);

export function getItems(): StoredItem[] {
  return selectAllItems.all() as StoredItem[];
}

export function getItem(item_id: string): StoredItem | null {
  return (selectItem.get(item_id) as StoredItem | undefined) ?? null;
}

export function upsertItem(item: StoredItem): void {
  const existing = getItem(item.item_id);
  const tx = db.transaction(() => {
    if (existing) {
      updateItemStmt.run(
        item.access_token,
        item.institution_name,
        item.linked_at,
        item.item_id
      );
      if (existing.access_token !== item.access_token) {
        clearCursorStmt.run(item.item_id);
      }
    } else {
      insertItemStmt.run(
        item.item_id,
        item.access_token,
        item.institution_name,
        item.linked_at
      );
    }
    insertSyncMetaStmt.run(item.item_id);
  });
  tx();
}

// --- Cursors ---

const selectCursor = db.prepare(
  `SELECT transactions_cursor FROM items WHERE item_id = ?`
);
const updateCursor = db.prepare(
  `UPDATE items SET transactions_cursor = ? WHERE item_id = ?`
);

export function getItemCursor(item_id: string): string | null {
  const row = selectCursor.get(item_id) as
    | { transactions_cursor: string | null }
    | undefined;
  return row?.transactions_cursor ?? null;
}

export function setItemCursor(item_id: string, cursor: string | null): void {
  updateCursor.run(cursor, item_id);
}

// --- Sync meta ---

const selectSyncMeta = db.prepare(`SELECT * FROM sync_meta WHERE item_id = ?`);
const selectAllSyncMeta = db.prepare(`SELECT * FROM sync_meta`);
const setAccountsFetchedAtStmt = db.prepare(
  `UPDATE sync_meta SET accounts_fetched_at = ? WHERE item_id = ?`
);
const setTransactionsFetchedAtStmt = db.prepare(
  `UPDATE sync_meta SET transactions_fetched_at = ? WHERE item_id = ?`
);
const setTransactionsLastErrorStmt = db.prepare(
  `UPDATE sync_meta SET transactions_last_error = ? WHERE item_id = ?`
);

export function getSyncMeta(item_id: string): SyncMeta | null {
  return (selectSyncMeta.get(item_id) as SyncMeta | undefined) ?? null;
}

export function getAllSyncMeta(): SyncMeta[] {
  return selectAllSyncMeta.all() as SyncMeta[];
}

export function setAccountsFetchedAt(item_id: string, iso: string): void {
  setAccountsFetchedAtStmt.run(iso, item_id);
}

export function setTransactionsFetchedAt(item_id: string, iso: string): void {
  setTransactionsFetchedAtStmt.run(iso, item_id);
}

export function setTransactionsLastError(
  item_id: string,
  msg: string | null
): void {
  setTransactionsLastErrorStmt.run(msg, item_id);
}

// --- Accounts ---

const upsertAccountStmt = db.prepare(
  `INSERT INTO accounts (
     account_id, item_id, name, official_name, type, subtype, mask, currency,
     balance_current, balance_available, balance_limit, updated_at
   ) VALUES (@account_id, @item_id, @name, @official_name, @type, @subtype, @mask, @currency,
     @balance_current, @balance_available, @balance_limit, @updated_at)
   ON CONFLICT(account_id) DO UPDATE SET
     name = excluded.name,
     official_name = excluded.official_name,
     type = excluded.type,
     subtype = excluded.subtype,
     mask = excluded.mask,
     currency = excluded.currency,
     balance_current = excluded.balance_current,
     balance_available = excluded.balance_available,
     balance_limit = excluded.balance_limit,
     updated_at = excluded.updated_at`
);

const selectAccountsForItem = db.prepare(
  `SELECT * FROM accounts WHERE item_id = ?`
);

interface PlaidAccountLike {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  mask?: string | null;
  balances?: {
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
    current?: number | null;
    available?: number | null;
    limit?: number | null;
  } | null;
}

export function upsertAccounts(
  item_id: string,
  accounts: PlaidAccountLike[]
): void {
  const now = new Date().toISOString();
  const tx = db.transaction((rows: PlaidAccountLike[]) => {
    for (const a of rows) {
      const b = a.balances ?? {};
      upsertAccountStmt.run({
        account_id: a.account_id,
        item_id,
        name: a.name ?? null,
        official_name: a.official_name ?? null,
        type: a.type ?? null,
        subtype: a.subtype ?? null,
        mask: a.mask ?? null,
        currency: b.iso_currency_code ?? b.unofficial_currency_code ?? null,
        balance_current: b.current ?? null,
        balance_available: b.available ?? null,
        balance_limit: b.limit ?? null,
        updated_at: now,
      });
    }
  });
  tx(accounts);
}

export function getAccountsForItem(item_id: string): StoredAccount[] {
  return selectAccountsForItem.all(item_id) as StoredAccount[];
}

// --- Transactions ---

const selectTxnsInRange = db.prepare(
  `SELECT * FROM transactions
   WHERE date BETWEEN ? AND ?
   ORDER BY date DESC, transaction_id DESC`
);

const upsertTxnStmt = db.prepare(
  `INSERT INTO transactions (
     transaction_id, item_id, account_id, date, name, merchant_name, amount,
     currency, pending, pfc_primary, pfc_detailed, payment_channel, raw_json, updated_at
   ) VALUES (@transaction_id, @item_id, @account_id, @date, @name, @merchant_name, @amount,
     @currency, @pending, @pfc_primary, @pfc_detailed, @payment_channel, @raw_json, @updated_at)
   ON CONFLICT(transaction_id) DO UPDATE SET
     item_id = excluded.item_id,
     account_id = excluded.account_id,
     date = excluded.date,
     name = excluded.name,
     merchant_name = excluded.merchant_name,
     amount = excluded.amount,
     currency = excluded.currency,
     pending = excluded.pending,
     pfc_primary = excluded.pfc_primary,
     pfc_detailed = excluded.pfc_detailed,
     payment_channel = excluded.payment_channel,
     raw_json = excluded.raw_json,
     updated_at = excluded.updated_at`
);

const deleteTxnStmt = db.prepare(
  `DELETE FROM transactions WHERE transaction_id = ?`
);

interface PlaidTxnLike {
  transaction_id: string;
  account_id: string;
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  pending?: boolean | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
  payment_channel?: string | null;
}

interface RemovedTxnLike {
  transaction_id: string;
}

export function getTransactionsInRange(
  start: string,
  end: string
): StoredTransaction[] {
  return selectTxnsInRange.all(start, end) as StoredTransaction[];
}

export function applySyncPage(
  item_id: string,
  added: PlaidTxnLike[],
  modified: PlaidTxnLike[],
  removed: RemovedTxnLike[],
  next_cursor: string
): void {
  const now = new Date().toISOString();
  const toRow = (t: PlaidTxnLike) => ({
    transaction_id: t.transaction_id,
    item_id,
    account_id: t.account_id,
    date: t.date,
    name: t.name ?? null,
    merchant_name: t.merchant_name ?? null,
    amount: t.amount,
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
    pending: t.pending ? 1 : 0,
    pfc_primary: t.personal_finance_category?.primary ?? null,
    pfc_detailed: t.personal_finance_category?.detailed ?? null,
    payment_channel: t.payment_channel ?? null,
    raw_json: JSON.stringify(t),
    updated_at: now,
  });

  const tx = db.transaction(() => {
    for (const t of added) upsertTxnStmt.run(toRow(t));
    for (const t of modified) upsertTxnStmt.run(toRow(t));
    for (const r of removed) deleteTxnStmt.run(r.transaction_id);
    updateCursor.run(next_cursor, item_id);
  });
  tx();
}
