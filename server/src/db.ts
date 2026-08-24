import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DATA_DIR = path.join(__dirname, "..", "data");
// One DB file per Plaid environment. Access tokens are env-scoped
// (a production token is rejected in sandbox and vice-versa), so keeping
// sandbox/production/mock in separate files lets you flip PLAID_ENV
// without touching the other environment's linked items.
const PLAID_ENV = process.env.PLAID_ENV || "sandbox";
const DB_PATH = path.join(DATA_DIR, `finance.${PLAID_ENV}.db`);
const LEGACY_ITEMS_FILE = path.join(__dirname, "..", "items.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      item_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      transactions_cursor TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
      name TEXT,
      official_name TEXT,
      type TEXT,
      subtype TEXT,
      mask TEXT,
      currency TEXT,
      balance_current REAL,
      balance_available REAL,
      balance_limit REAL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_item ON accounts(item_id);

    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT,
      merchant_name TEXT,
      amount REAL NOT NULL,
      currency TEXT,
      pending INTEGER NOT NULL DEFAULT 0,
      pfc_primary TEXT,
      pfc_detailed TEXT,
      payment_channel TEXT,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_item_date ON transactions(item_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

    CREATE TABLE IF NOT EXISTS sync_meta (
      item_id TEXT PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
      accounts_fetched_at TEXT,
      transactions_fetched_at TEXT,
      transactions_last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS securities (
      security_id TEXT PRIMARY KEY,
      ticker_symbol TEXT,
      name TEXT,
      type TEXT,
      close_price REAL,
      close_price_as_of TEXT,
      iso_currency_code TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holdings (
      account_id TEXT NOT NULL,
      security_id TEXT NOT NULL REFERENCES securities(security_id),
      item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
      quantity REAL,
      institution_price REAL,
      institution_value REAL,
      cost_basis REAL,
      iso_currency_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, security_id)
    );
    CREATE INDEX IF NOT EXISTS idx_holdings_item ON holdings(item_id);
  `);

  addColumnIfMissing("sync_meta", "investments_fetched_at", "TEXT");
  addColumnIfMissing("sync_meta", "investments_last_error", "TEXT");
}

function addColumnIfMissing(
  table: string,
  column: string,
  defn: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defn}`);
  }
}

// Run at module load so tables exist before any importer's top-level
// db.prepare() calls (e.g. in store.ts).
initSchema();

interface LegacyItem {
  access_token: string;
  item_id: string;
  institution_name: string;
  linked_at: string;
}

export function migrateFromJsonIfNeeded(): void {
  // items.json predates env-scoped DBs — its tokens were production, so
  // only ever import them into the production DB. Otherwise a fresh
  // sandbox/mock DB would inherit unusable production tokens.
  if (PLAID_ENV !== "production") return;
  const row = db.prepare("SELECT COUNT(*) as n FROM items").get() as { n: number };
  if (row.n > 0) return;
  if (!fs.existsSync(LEGACY_ITEMS_FILE)) return;

  let legacy: LegacyItem[];
  try {
    const raw = fs.readFileSync(LEGACY_ITEMS_FILE, "utf-8").trim();
    if (!raw) return;
    legacy = JSON.parse(raw) as LegacyItem[];
  } catch (err) {
    console.error("[migrate] Failed to read items.json — skipping", err);
    return;
  }

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO items (item_id, access_token, institution_name, linked_at)
     VALUES (?, ?, ?, ?)`
  );
  const insertMeta = db.prepare(
    `INSERT OR IGNORE INTO sync_meta (item_id) VALUES (?)`
  );

  const tx = db.transaction((items: LegacyItem[]) => {
    for (const it of items) {
      insertItem.run(it.item_id, it.access_token, it.institution_name, it.linked_at);
      insertMeta.run(it.item_id);
    }
  });
  tx(legacy);

  console.log(
    `[migrate] Imported ${legacy.length} item(s) from items.json — file left in place; you can delete it manually.`
  );
}
