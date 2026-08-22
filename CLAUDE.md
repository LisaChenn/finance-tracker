# Finance Tracker

A local personal finance dashboard: React + TS (Vite) client, Express + TS
server, using Plaid to link bank accounts and show aggregated balances.

## Structure

- `server/` — Express + TS API. Holds the Plaid secret; never exposed to
  the client. Access tokens for linked accounts are stored locally in
  `server/items.json`.
- `client/` — React + TS (Vite) dashboard UI. Proxies `/api` to the server
  on port 8080.

## Commands

- Server: `cd server && npm run dev` — runs on http://localhost:8080
- Client: `cd client && npm run dev` — runs on http://localhost:5173
- Run both in separate terminals.

## Rules

- Never read, print, or otherwise access `server/.env` (or any `.env*` file
  in this repo). It holds live Plaid secrets. Use `server/.env.example` as
  the reference for what variables exist instead.
- Never create, copy over, move, or delete `server/.env` (or any `.env*`
  file except `.env.example`). No `cp .env.example .env`, no `rm .env`, no
  `mv`, no `> .env` redirection — nothing that could overwrite or remove
  an existing `.env`, even to "smoke test" the server. `.env` is
  gitignored so lost keys can't be recovered from git history. If a task
  seems to need a fresh `.env`, stop and ask the user first.
- Never read, print, or commit `server/items.json`. It holds real Plaid
  access tokens for linked accounts once the user links a real institution.
  It's gitignored — keep it that way.
- This app has no authentication layer and is meant for local, single-user
  use only. Don't suggest or implement deploying it to a public server.
