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
  investments_fetched_at: string | null;
  investments_last_error: string | null;
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
const setInvestmentsFetchedAtStmt = db.prepare(
  `UPDATE sync_meta SET investments_fetched_at = ? WHERE item_id = ?`
);
const setInvestmentsLastErrorStmt = db.prepare(
  `UPDATE sync_meta SET investments_last_error = ? WHERE item_id = ?`
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

export function setInvestmentsFetchedAt(item_id: string, iso: string): void {
  setInvestmentsFetchedAtStmt.run(iso, item_id);
}

export function setInvestmentsLastError(
  item_id: string,
  msg: string | null
): void {
  setInvestmentsLastErrorStmt.run(msg, item_id);
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

// --- Investments (securities + holdings) ---

const upsertSecurityStmt = db.prepare(
  `INSERT INTO securities (
     security_id, ticker_symbol, name, type, close_price, close_price_as_of,
     iso_currency_code, updated_at
   ) VALUES (@security_id, @ticker_symbol, @name, @type, @close_price,
     @close_price_as_of, @iso_currency_code, @updated_at)
   ON CONFLICT(security_id) DO UPDATE SET
     ticker_symbol = excluded.ticker_symbol,
     name = excluded.name,
     type = excluded.type,
     close_price = excluded.close_price,
     close_price_as_of = excluded.close_price_as_of,
     iso_currency_code = excluded.iso_currency_code,
     updated_at = excluded.updated_at`
);

const upsertHoldingStmt = db.prepare(
  `INSERT INTO holdings (
     account_id, security_id, item_id, quantity, institution_price,
     institution_value, cost_basis, iso_currency_code, updated_at
   ) VALUES (@account_id, @security_id, @item_id, @quantity, @institution_price,
     @institution_value, @cost_basis, @iso_currency_code, @updated_at)
   ON CONFLICT(account_id, security_id) DO UPDATE SET
     item_id = excluded.item_id,
     quantity = excluded.quantity,
     institution_price = excluded.institution_price,
     institution_value = excluded.institution_value,
     cost_basis = excluded.cost_basis,
     iso_currency_code = excluded.iso_currency_code,
     updated_at = excluded.updated_at`
);

const deleteHoldingsForItemStmt = db.prepare(
  `DELETE FROM holdings WHERE item_id = ?`
);

const selectHoldingsForItemStmt = db.prepare(
  `SELECT h.account_id, h.security_id, h.quantity, h.institution_price,
          h.institution_value, h.cost_basis, h.iso_currency_code,
          s.ticker_symbol AS s_ticker_symbol,
          s.name          AS s_name,
          s.type          AS s_type,
          s.close_price   AS s_close_price,
          s.close_price_as_of AS s_close_price_as_of,
          s.iso_currency_code AS s_iso_currency_code
     FROM holdings h
     LEFT JOIN securities s USING (security_id)
    WHERE h.item_id = ?`
);

interface PlaidSecurityLike {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
  close_price?: number | null;
  close_price_as_of?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

interface PlaidHoldingLike {
  account_id: string;
  security_id: string;
  quantity?: number | null;
  institution_price?: number | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

export interface StoredHoldingRow {
  account_id: string;
  security_id: string;
  quantity: number | null;
  institution_price: number | null;
  institution_value: number | null;
  cost_basis: number | null;
  iso_currency_code: string | null;
  security: {
    ticker_symbol: string | null;
    name: string | null;
    type: string | null;
    close_price: number | null;
    close_price_as_of: string | null;
    iso_currency_code: string | null;
  };
}

export function upsertSecurities(securities: PlaidSecurityLike[]): void {
  const now = new Date().toISOString();
  const tx = db.transaction((rows: PlaidSecurityLike[]) => {
    for (const s of rows) {
      upsertSecurityStmt.run({
        security_id: s.security_id,
        ticker_symbol: s.ticker_symbol ?? null,
        name: s.name ?? null,
        type: s.type ?? null,
        close_price: s.close_price ?? null,
        close_price_as_of: s.close_price_as_of ?? null,
        iso_currency_code:
          s.iso_currency_code ?? s.unofficial_currency_code ?? null,
        updated_at: now,
      });
    }
  });
  tx(securities);
}

// Replace-in-place: delete stale holdings for this item, then insert current.
// This matches how the Plaid response reflects the full current state.
export function replaceHoldings(
  item_id: string,
  holdings: PlaidHoldingLike[]
): void {
  const now = new Date().toISOString();
  const tx = db.transaction((rows: PlaidHoldingLike[]) => {
    deleteHoldingsForItemStmt.run(item_id);
    for (const h of rows) {
      upsertHoldingStmt.run({
        account_id: h.account_id,
        security_id: h.security_id,
        item_id,
        quantity: h.quantity ?? null,
        institution_price: h.institution_price ?? null,
        institution_value: h.institution_value ?? null,
        cost_basis: h.cost_basis ?? null,
        iso_currency_code:
          h.iso_currency_code ?? h.unofficial_currency_code ?? null,
        updated_at: now,
      });
    }
  });
  tx(holdings);
}

interface HoldingJoinRow {
  account_id: string;
  security_id: string;
  quantity: number | null;
  institution_price: number | null;
  institution_value: number | null;
  cost_basis: number | null;
  iso_currency_code: string | null;
  s_ticker_symbol: string | null;
  s_name: string | null;
  s_type: string | null;
  s_close_price: number | null;
  s_close_price_as_of: string | null;
  s_iso_currency_code: string | null;
}

export function getHoldingsForItem(item_id: string): StoredHoldingRow[] {
  const rows = selectHoldingsForItemStmt.all(item_id) as HoldingJoinRow[];
  return rows.map((r) => ({
    account_id: r.account_id,
    security_id: r.security_id,
    quantity: r.quantity,
    institution_price: r.institution_price,
    institution_value: r.institution_value,
    cost_basis: r.cost_basis,
    iso_currency_code: r.iso_currency_code,
    security: {
      ticker_symbol: r.s_ticker_symbol,
      name: r.s_name,
      type: r.s_type,
      close_price: r.s_close_price,
      close_price_as_of: r.s_close_price_as_of,
      iso_currency_code: r.s_iso_currency_code,
    },
  }));
}
