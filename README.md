# Finance Tracker

A local personal finance dashboard that links your bank accounts via Plaid and
shows aggregated balances across institutions.

- `server/` — Express + TypeScript API. Holds your Plaid secret; never exposed to the client.
- `client/` — React + TypeScript (Vite) dashboard UI.

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
- Access tokens are stored locally in `server/items.json` (plaintext,
  gitignored — never commit this file). There's no real database; it's just
  a JSON read/write helper, fine for a single-user local tool.
- The dashboard calls `GET /api/accounts`, which loops over every linked
  item, fetches balances via `accountsBalanceGet`, and groups the results by
  institution. Net worth is the sum of all current balances.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/create_link_token` | Creates a Plaid Link token (`transactions`, `investments`, US) |
| POST | `/api/exchange_public_token` | Exchanges a `public_token` for an `access_token` and stores it |
| GET | `/api/accounts` | Balances for every linked item, grouped by institution |
| GET | `/api/transactions` | Transactions for every linked item; `?start=YYYY-MM-DD&end=YYYY-MM-DD` (defaults to the last 30 days) |
| GET | `/api/items` | Lists linked institutions (no tokens exposed) |

## Security notes

- `server/.env` and `server/items.json` are gitignored — don't commit real
  Plaid secrets or access tokens.
- This is designed for local, single-user use. It has no authentication
  layer; don't deploy it as-is to a public server.
