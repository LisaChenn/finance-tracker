# Finance Tracker

A local personal finance dashboard that links your bank accounts via Plaid,
shows aggregated balances across institutions, and breaks down your spending
by category. Data is cached locally in SQLite and refreshed in the background
so the UI is instant on every load.

- `server/` — Express + TypeScript API. Holds your Plaid secret; never exposed to the client.
- `client/` — React + TypeScript (Vite) dashboard UI.

## Features

- **Accounts view** — every linked institution's balances, grouped by bank, with a running net worth total.
- **Spending view** — donut chart of spending by Plaid personal-finance category (click a slice to drill into detailed subcategories), a top-merchants list, and a searchable/filterable transactions table.
- **Date-range picker** — 30d / 90d / MTD / YTD / custom.
- **Filters** — search, per-account chips, per-category dropdown.
- **Stale-while-revalidate** — first paint is instant from the local cache; fresh data is fetched in the background and swapped in automatically without a manual refresh.

## Setup

### 1. Get Plaid API keys

Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) — it's free. From
the dashboard, grab your `client_id` and `secret` (there's a separate secret
per environment: Sandbox, Development/Production).

### 2. Configure the server

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env`:

```
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SANDBOX_SECRET=your_plaid_sandbox_secret
PLAID_PRODUCTION_SECRET=your_plaid_production_secret
PLAID_ENV=sandbox
PORT=8080
```

Plaid gives you a separate secret per environment — you can fill in both
and switch by flipping `PLAID_ENV` between `sandbox` and `production`
without editing the secrets.

### 3. Configure the client

```bash
cd client
npm install
```

No env vars needed — the Vite dev server proxies `/api` to `http://localhost:8080`.

### 4. Run it

In two separate terminals:

```bash
cd server && npm run dev   # http://localhost:8080
cd client && npm run dev   # http://localhost:5173
```

Open http://localhost:5173.

## Linking accounts

1. **Start in Sandbox** (`PLAID_ENV=sandbox`). Click a "Link [Institution]"
   button and use Plaid's test credentials: username `user_good`, password
   `pass_good`.
2. Once you've confirmed the flow works end-to-end, switch to **real
   accounts**. Plaid's free **Trial plan** supports up to 10 real linked
   Items at no cost — just switch `PLAID_ENV` to `development` (or
   `production`) and use your live secret.
3. **Fidelity** may not appear by default. If it's missing, request access
   via the [Plaid Compliance Center](https://dashboard.plaid.com) under your
   dashboard's institution access settings.

## How it works

- Linking an account runs Plaid Link in the browser, which returns a
  `public_token`. The client sends that to the server, which exchanges it
  for a permanent `access_token`.
- Access tokens, cached balances, and cached transactions live in a local
  SQLite database at `server/data/finance.db` (gitignored, plaintext — same
  trust boundary as `server/items.json`). Legacy tokens in `items.json` are
  auto-migrated into the DB on first boot; the JSON file is left in place
  and you can delete it manually after you confirm the migration.
- **Read path** is a local `SELECT` — `GET /api/accounts` and
  `GET /api/transactions` never hit Plaid. Responses come back in tens of
  milliseconds.
- **Write path** runs in the background. Adding `?refresh=1` (or having no
  cached data yet) schedules a per-item refresh that calls
  `accountsBalanceGet` for balances and Plaid's `transactionsSync` for
  transactions. `transactionsSync` uses a persisted cursor per item, so
  after the first pull only added/modified/removed deltas come across the
  wire.
- The client polls a tiny `GET /api/sync/status` endpoint for ~30s after a
  refresh trigger; when a `*_fetched_at` timestamp bumps, it re-fetches the
  affected view and the new data swaps in without a manual refresh.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/create_link_token` | Creates a Plaid Link token (`transactions`, `investments`, US) |
| POST | `/api/exchange_public_token` | Exchanges a `public_token` for an `access_token`, stores it, and schedules an initial background sync |
| GET | `/api/accounts` | Cached balances grouped by institution. Add `?refresh=1` to also schedule a background refresh from Plaid |
| GET | `/api/transactions` | Cached transactions; `?start=YYYY-MM-DD&end=YYYY-MM-DD` (defaults to the last 30 days). Add `?refresh=1` to schedule a background sync |
| GET | `/api/sync/status` | Per-item `accounts_fetched_at` / `transactions_fetched_at` timestamps + any last sync error. Client polls this to auto-swap fresh data |
| GET | `/api/items` | Lists linked institutions (no tokens exposed) |

## Security notes

- `server/.env`, `server/items.json`, and `server/data/` (SQLite + WAL
  sidecars) are gitignored — don't commit real Plaid secrets, access
  tokens, or the cache DB.
- This is designed for local, single-user use. It has no authentication
  layer; don't deploy it as-is to a public server.

## Troubleshooting

- **`better-sqlite3` "invalid ELF header" or similar after a Node upgrade**:
  the prebuilt native binary is tied to a specific Node ABI. Run
  `cd server && npm rebuild better-sqlite3`.
- **Freshly-linked institution shows no transactions yet**: Plaid may return
  `PRODUCT_NOT_READY` for a minute or so after linking. The sync engine
  retries with exponential backoff (1s / 3s / 9s). If it ultimately fails,
  the error is recorded in `sync_meta.transactions_last_error` and will be
  retried on the next refresh.
