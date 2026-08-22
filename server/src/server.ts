import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { Products, CountryCode } from "plaid";
import { plaidClient, plaidErrorSummary } from "./plaid";
import { migrateFromJsonIfNeeded } from "./db";
import {
  getAccountsForItem,
  getAllSyncMeta,
  getItems,
  getSyncMeta,
  getTransactionsInRange,
  upsertItem,
  StoredItem,
} from "./store";
import {
  scheduleRefreshAccounts,
  scheduleSyncTransactions,
} from "./sync";

const PORT = Number(process.env.PORT) || 8080;

migrateFromJsonIfNeeded();

// Restrict CORS to localhost/127.0.0.1 dev servers only. Remote pages
// can't spoof a localhost Origin header, so this blocks the "malicious
// website reads your bank data via fetch()" vector while still letting
// Vite pick any local port (5173, 5174, 5175 fallback, etc.).
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || LOCAL_ORIGIN_RE.test(origin)) return cb(null, true);
      cb(new Error(`Origin not allowed: ${origin}`));
    },
  })
);
app.use(express.json());

function isRefreshRequested(req: Request): boolean {
  return req.query.refresh === "1";
}

app.post("/api/create_link_token", async (req: Request, res: Response) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "local-user",
      },
      client_name: "Finance Dashboard",
      products: [Products.Transactions, Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ link_token: response.data.link_token });
  } catch (error: any) {
    console.error("create_link_token error", plaidErrorSummary(error));
    res.status(500).json({ error: "Failed to create link token" });
  }
});

app.post("/api/exchange_public_token", async (req: Request, res: Response) => {
  const { public_token, institution_name } = req.body as {
    public_token?: string;
    institution_name?: string;
  };

  if (!public_token || !institution_name) {
    return res
      .status(400)
      .json({ error: "public_token and institution_name are required" });
  }

  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const item: StoredItem = {
      access_token: response.data.access_token,
      item_id: response.data.item_id,
      institution_name,
      linked_at: new Date().toISOString(),
    };

    upsertItem(item);
    // Fire-and-forget backfill so the newly-linked institution starts syncing
    // immediately. PRODUCT_NOT_READY retries live inside sync.ts.
    scheduleRefreshAccounts(item.item_id);
    scheduleSyncTransactions(item.item_id);
    res.json({ success: true, item_id: item.item_id });
  } catch (error: any) {
    console.error("exchange_public_token error", plaidErrorSummary(error));
    res.status(500).json({ error: "Failed to exchange public token" });
  }
});

app.get("/api/accounts", (req: Request, res: Response) => {
  const items = getItems();
  const refresh = isRefreshRequested(req);

  const groups = items.map((item) => {
    const accounts = getAccountsForItem(item.item_id).map((a) => ({
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
      balances: {
        available: a.balance_available,
        current: a.balance_current,
        limit: a.balance_limit,
        iso_currency_code: a.currency,
        unofficial_currency_code: null,
      },
    }));
    const meta = getSyncMeta(item.item_id);
    const fetched_at = meta?.accounts_fetched_at ?? null;

    if (refresh || fetched_at === null) {
      scheduleRefreshAccounts(item.item_id);
    }

    return {
      institution_name: item.institution_name,
      item_id: item.item_id,
      accounts,
      fetched_at,
    };
  });

  res.json({ groups, cached: true });
});

app.get("/api/transactions", (req: Request, res: Response) => {
  const items = getItems();
  const refresh = isRefreshRequested(req);

  const end = (req.query.end as string) || new Date().toISOString().slice(0, 10);
  const start =
    (req.query.start as string) ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = getTransactionsInRange(start, end);
  const byItem = new Map<string, any[]>();
  for (const r of rows) {
    let arr = byItem.get(r.item_id);
    if (!arr) {
      arr = [];
      byItem.set(r.item_id, arr);
    }
    arr.push(JSON.parse(r.raw_json));
  }

  const groups = items.map((item) => {
    const meta = getSyncMeta(item.item_id);
    const fetched_at = meta?.transactions_fetched_at ?? null;
    const stale_reason = meta?.transactions_last_error ?? undefined;

    if (refresh || fetched_at === null) {
      scheduleSyncTransactions(item.item_id);
    }

    return {
      institution_name: item.institution_name,
      item_id: item.item_id,
      transactions: byItem.get(item.item_id) ?? [],
      fetched_at,
      ...(stale_reason ? { stale_reason } : {}),
    };
  });

  res.json({ start, end, groups, cached: true });
});

app.get("/api/sync/status", (req: Request, res: Response) => {
  const items = getItems();
  const metaById = new Map(getAllSyncMeta().map((m) => [m.item_id, m]));
  const out = items.map((item) => {
    const m = metaById.get(item.item_id);
    return {
      item_id: item.item_id,
      institution_name: item.institution_name,
      accounts_fetched_at: m?.accounts_fetched_at ?? null,
      transactions_fetched_at: m?.transactions_fetched_at ?? null,
      transactions_last_error: m?.transactions_last_error ?? null,
    };
  });
  res.json({ items: out });
});

app.get("/api/items", (req: Request, res: Response) => {
  const items = getItems().map((item) => ({
    item_id: item.item_id,
    institution_name: item.institution_name,
    linked_at: item.linked_at,
  }));
  res.json({ items });
});

// Bind to loopback only — this app has no auth layer and holds Plaid
// access tokens, so it must not be reachable from other machines on the
// local network. Override via HOST env var if you really need to (don't).
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(`Finance tracker server listening on http://${HOST}:${PORT}`);
});
