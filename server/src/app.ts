import express, { Request, Response } from "express";
import cors from "cors";
import { Products, CountryCode } from "plaid";
import { plaidClient, plaidErrorSummary } from "./plaid";
import {
  deleteBucketOverride,
  getAccountsForItem,
  getAllSyncMeta,
  getBucketOverrides,
  getHoldingsForItem,
  getHoldingsSnapshotsSince,
  getItems,
  getSyncMeta,
  getTargetAllocations,
  getTotalHoldingsValue,
  getTransactionsInRange,
  setBucketOverride,
  setTargetAllocations,
  upsertHoldingsSnapshot,
  upsertItem,
  StoredHoldingRow,
  StoredItem,
} from "./store";
import { computeDrift } from "./allocation";
import {
  scheduleRefreshAccounts,
  scheduleRefreshInvestments,
  scheduleSyncTransactions,
} from "./sync";

// Restrict CORS to localhost/127.0.0.1 dev servers only. Remote pages
// can't spoof a localhost Origin header, so this blocks the "malicious
// website reads your bank data via fetch()" vector while still letting
// Vite pick any local port (5173, 5174, 5175 fallback, etc.).
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const app = express();

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
    scheduleRefreshInvestments(item.item_id);
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
      investments_fetched_at: m?.investments_fetched_at ?? null,
      investments_last_error: m?.investments_last_error ?? null,
    };
  });
  res.json({ items: out });
});

app.get("/api/investments", (req: Request, res: Response) => {
  const items = getItems();
  const refresh = isRefreshRequested(req);

  const groups = items.map((item) => {
    const holdings = getHoldingsForItem(item.item_id);
    const meta = getSyncMeta(item.item_id);
    const fetched_at = meta?.investments_fetched_at ?? null;
    const stale_reason = meta?.investments_last_error ?? undefined;

    if (refresh || fetched_at === null) {
      scheduleRefreshInvestments(item.item_id);
    }

    return {
      institution_name: item.institution_name,
      item_id: item.item_id,
      holdings,
      fetched_at,
      ...(stale_reason ? { stale_reason } : {}),
    };
  });

  res.json({ groups, cached: true });
});

// Dev-only: fabricate a backward random walk of daily snapshots ending
// yesterday, so the sparkline has something lived-in to draw before real
// days accumulate. Refuses in production — never touch real snapshots.
app.post("/api/investments/history/seed", (req: Request, res: Response) => {
  if ((process.env.PLAID_ENV || "sandbox") === "production") {
    return res
      .status(403)
      .json({ error: "Seeding is disabled when PLAID_ENV=production" });
  }
  const raw = req.query.days;
  let days = 30;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 2 || parsed > 365) {
      return res.status(400).json({ error: "days must be between 2 and 365" });
    }
    days = Math.floor(parsed);
  }
  // Anchor at the real current portfolio total so the fake history flows
  // naturally into today's live value. Fallback if nothing's linked yet.
  const anchor = getTotalHoldingsValue() || 50000;
  const oneDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const written: { date: string; total_value: number }[] = [];
  let value = anchor;
  for (let i = 1; i <= days; i++) {
    // Walk backward with ±1% noise so the line has visible movement but
    // stays plausible (no spikes, no monotonic drift toward zero).
    const factor = 1 + (Math.random() - 0.5) * 0.02;
    value = value / factor;
    const date = new Date(now - i * oneDay).toISOString().slice(0, 10);
    written.push({ date, total_value: Math.round(value * 100) / 100 });
  }
  for (const s of written) upsertHoldingsSnapshot(s.date, s.total_value);
  written.sort((a, b) => (a.date < b.date ? -1 : 1));
  res.json({ seeded: written.length, anchor, snapshots: written });
});

app.get("/api/investments/history", (req: Request, res: Response) => {
  const raw = req.query.days;
  let days = 90;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return res.status(400).json({ error: "days must be a positive number" });
    }
    days = Math.min(Math.floor(parsed), 365);
  }
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const snapshots = getHoldingsSnapshotsSince(since);
  res.json({ days, snapshots });
});

app.get("/api/allocation/targets", (_req: Request, res: Response) => {
  res.json({ targets: getTargetAllocations() });
});

app.put("/api/allocation/targets", (req: Request, res: Response) => {
  const body = req.body as { targets?: unknown };
  if (!Array.isArray(body.targets)) {
    return res.status(400).json({ error: "targets must be an array" });
  }
  try {
    setTargetAllocations(body.targets as { bucket: string; target_pct: number }[]);
    res.json({ success: true, targets: getTargetAllocations() });
  } catch (err: any) {
    // setTargetAllocations throws on unknown/duplicate bucket, invalid pct,
    // or a sum that doesn't equal 100 — all of which are 400s.
    res.status(400).json({ error: err?.message ?? "Invalid targets" });
  }
});

app.get("/api/allocation/overrides", (_req: Request, res: Response) => {
  res.json({ overrides: getBucketOverrides() });
});

app.put("/api/allocation/override", (req: Request, res: Response) => {
  const { ticker, bucket } = req.body as {
    ticker?: unknown;
    bucket?: unknown;
  };
  if (typeof ticker !== "string" || typeof bucket !== "string") {
    return res
      .status(400)
      .json({ error: "ticker and bucket must be strings" });
  }
  try {
    setBucketOverride(ticker, bucket);
    res.json({ success: true });
  } catch (err: any) {
    // setBucketOverride throws on empty ticker or unknown bucket.
    res.status(400).json({ error: err?.message ?? "Invalid override" });
  }
});

app.delete(
  "/api/allocation/override/:ticker",
  (req: Request, res: Response) => {
    const ticker = req.params.ticker;
    if (!ticker || !ticker.trim()) {
      return res.status(400).json({ error: "ticker is required" });
    }
    // No-op if the override doesn't exist — DELETE is idempotent.
    deleteBucketOverride(ticker);
    res.json({ success: true });
  }
);

app.get("/api/allocation/drift", (req: Request, res: Response) => {
  const items = getItems();
  const holdings: StoredHoldingRow[] = [];
  for (const it of items) {
    holdings.push(...getHoldingsForItem(it.item_id));
  }

  let deposit: number | undefined;
  if (req.query.deposit !== undefined) {
    const parsed = Number(req.query.deposit);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return res
        .status(400)
        .json({ error: "deposit must be a non-negative number" });
    }
    deposit = parsed;
  }

  const result = computeDrift(
    holdings,
    getTargetAllocations(),
    getBucketOverrides(),
    deposit
  );
  res.json(result);
});

app.get("/api/items", (req: Request, res: Response) => {
  const items = getItems().map((item) => ({
    item_id: item.item_id,
    institution_name: item.institution_name,
    linked_at: item.linked_at,
  }));
  res.json({ items });
});
