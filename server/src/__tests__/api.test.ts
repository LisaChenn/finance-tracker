import { describe, test, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { plaidClient } from "../plaid";
import { db } from "../db";

// Reset tables + reinstall permissive plaid mocks before every test so
// state from one case never leaks into the next. Individual tests
// override the specific method they care about.
beforeEach(() => {
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM holdings;
    DELETE FROM securities;
    DELETE FROM accounts;
    DELETE FROM sync_meta;
    DELETE FROM items;
  `);

  plaidClient.linkTokenCreate = vi.fn(async () => ({
    data: { link_token: "link-sandbox-default" },
  })) as any;
  plaidClient.itemPublicTokenExchange = vi.fn(async () => ({
    data: { access_token: "access-sandbox-abc", item_id: "item-abc" },
  })) as any;
  // Fire-and-forget syncs run after exchange — return empty payloads so they
  // no-op instead of hitting the real Plaid API.
  plaidClient.accountsBalanceGet = vi.fn(async () => ({
    data: { accounts: [] },
  })) as any;
  plaidClient.transactionsSync = vi.fn(async () => ({
    data: {
      added: [],
      modified: [],
      removed: [],
      next_cursor: "c",
      has_more: false,
    },
  })) as any;
  plaidClient.investmentsHoldingsGet = vi.fn(async () => ({
    data: { accounts: [], holdings: [], securities: [] },
  })) as any;
});

describe("POST /api/create_link_token", () => {
  test("returns a link token on success", async () => {
    const res = await request(app).post("/api/create_link_token").send({});
    expect(res.status).toBe(200);
    expect(res.body.link_token).toBe("link-sandbox-default");
  });

  test("returns 500 when Plaid throws", async () => {
    plaidClient.linkTokenCreate = vi.fn(async () => {
      throw new Error("plaid down");
    }) as any;

    const res = await request(app).post("/api/create_link_token").send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create link token" });
  });
});

describe("POST /api/exchange_public_token", () => {
  test("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/exchange_public_token")
      .send({ public_token: "public-sandbox-foo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test("persists an item on success", async () => {
    const res = await request(app)
      .post("/api/exchange_public_token")
      .send({ public_token: "public-sandbox-foo", institution_name: "Chase" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, item_id: "item-abc" });

    const row = db
      .prepare("SELECT item_id, institution_name FROM items WHERE item_id = ?")
      .get("item-abc") as { item_id: string; institution_name: string };
    expect(row).toEqual({ item_id: "item-abc", institution_name: "Chase" });
  });
});

describe("GET /api/items", () => {
  test("never leaks access_token in the response", async () => {
    // Seed a linked item directly so we can inspect the API shape.
    db.prepare(
      `INSERT INTO items (item_id, access_token, institution_name, linked_at)
       VALUES (?, ?, ?, ?)`
    ).run("item-xyz", "access-sandbox-SECRET", "Fidelity", "2026-08-24T00:00:00Z");
    db.prepare(`INSERT INTO sync_meta (item_id) VALUES (?)`).run("item-xyz");

    const res = await request(app).get("/api/items");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("access-sandbox-SECRET");
    expect(raw).not.toContain("access_token");

    expect(res.body.items[0]).toEqual({
      item_id: "item-xyz",
      institution_name: "Fidelity",
      linked_at: "2026-08-24T00:00:00Z",
    });
  });
});

describe("GET /api/accounts", () => {
  test("returns groups shaped correctly with balances", async () => {
    db.prepare(
      `INSERT INTO items (item_id, access_token, institution_name, linked_at)
       VALUES (?, ?, ?, ?)`
    ).run("item-1", "access-1", "Chase", "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO sync_meta (item_id, accounts_fetched_at) VALUES (?, ?)`
    ).run("item-1", "2026-08-24T01:00:00Z");
    db.prepare(
      `INSERT INTO accounts (
         account_id, item_id, name, official_name, type, subtype, mask,
         currency, balance_current, balance_available, balance_limit, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "acct-1",
      "item-1",
      "Checking",
      "Chase Total Checking",
      "depository",
      "checking",
      "1234",
      "USD",
      1500.5,
      1400.0,
      null,
      "2026-08-24T01:00:00Z"
    );

    const res = await request(app).get("/api/accounts");
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    const group = res.body.groups[0];
    expect(group.institution_name).toBe("Chase");
    expect(group.accounts).toHaveLength(1);
    expect(group.accounts[0]).toMatchObject({
      account_id: "acct-1",
      mask: "1234",
      balances: {
        available: 1400.0,
        current: 1500.5,
        limit: null,
        iso_currency_code: "USD",
      },
    });
  });
});
