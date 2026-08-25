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
    DELETE FROM target_allocations;
    DELETE FROM security_bucket_overrides;
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

describe("targets endpoints", () => {
  test("GET returns [] when nothing is stored", async () => {
    const res = await request(app).get("/api/allocation/targets");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ targets: [] });
  });

  test("PUT stores targets and GET reads them back", async () => {
    const put = await request(app)
      .put("/api/allocation/targets")
      .send({
        targets: [
          { bucket: "us_stocks", target_pct: 60 },
          { bucket: "intl_stocks", target_pct: 20 },
          { bucket: "bonds", target_pct: 15 },
          { bucket: "cash", target_pct: 5 },
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.targets).toHaveLength(4);

    const get = await request(app).get("/api/allocation/targets");
    const byBucket = Object.fromEntries(
      get.body.targets.map((t: any) => [t.bucket, t.target_pct])
    );
    expect(byBucket).toEqual({
      us_stocks: 60,
      intl_stocks: 20,
      bonds: 15,
      cash: 5,
    });
  });

  test("PUT rejects a body that isn't an array", async () => {
    const res = await request(app)
      .put("/api/allocation/targets")
      .send({ targets: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be an array/);
  });

  test("PUT rejects when the sum doesn't equal 100", async () => {
    const res = await request(app)
      .put("/api/allocation/targets")
      .send({
        targets: [
          { bucket: "us_stocks", target_pct: 60 },
          { bucket: "bonds", target_pct: 30 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum to 100/);
  });

  test("PUT rejects an unknown bucket", async () => {
    const res = await request(app)
      .put("/api/allocation/targets")
      .send({
        targets: [
          { bucket: "us_stocks", target_pct: 50 },
          { bucket: "crypto", target_pct: 50 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown bucket/);
  });

  test("PUT with empty array clears targets", async () => {
    await request(app)
      .put("/api/allocation/targets")
      .send({
        targets: [
          { bucket: "us_stocks", target_pct: 100 },
        ],
      });

    const clear = await request(app)
      .put("/api/allocation/targets")
      .send({ targets: [] });
    expect(clear.status).toBe(200);

    const get = await request(app).get("/api/allocation/targets");
    expect(get.body.targets).toEqual([]);
  });
});

describe("overrides endpoints", () => {
  test("GET returns [] when nothing is stored", async () => {
    const res = await request(app).get("/api/allocation/overrides");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overrides: [] });
  });

  test("PUT stores an override and GET reads it back (ticker upper-cased)", async () => {
    const put = await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "voo", bucket: "us_stocks" });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await request(app).get("/api/allocation/overrides");
    expect(get.body.overrides).toHaveLength(1);
    expect(get.body.overrides[0]).toMatchObject({
      ticker_symbol: "VOO",
      bucket: "us_stocks",
    });
  });

  test("PUT upserts on repeated writes for the same ticker", async () => {
    await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "VOO", bucket: "us_stocks" });
    await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "VOO", bucket: "intl_stocks" });

    const get = await request(app).get("/api/allocation/overrides");
    expect(get.body.overrides).toHaveLength(1);
    expect(get.body.overrides[0].bucket).toBe("intl_stocks");
  });

  test("PUT rejects when body fields are missing or wrong type", async () => {
    const r1 = await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "VOO" });
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .put("/api/allocation/override")
      .send({ ticker: 42, bucket: "us_stocks" });
    expect(r2.status).toBe(400);
  });

  test("PUT rejects an unknown bucket", async () => {
    const res = await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "VOO", bucket: "crypto" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown bucket/);
  });

  test("DELETE removes an override", async () => {
    await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "BND", bucket: "bonds" });

    const del = await request(app).delete("/api/allocation/override/BND");
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await request(app).get("/api/allocation/overrides");
    expect(get.body.overrides).toEqual([]);
  });

  test("DELETE is idempotent on missing tickers", async () => {
    const del = await request(app).delete("/api/allocation/override/NOPE");
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
  });

  test("DELETE matches case-insensitively", async () => {
    await request(app)
      .put("/api/allocation/override")
      .send({ ticker: "BND", bucket: "bonds" });
    const del = await request(app).delete("/api/allocation/override/bnd");
    expect(del.status).toBe(200);
    const get = await request(app).get("/api/allocation/overrides");
    expect(get.body.overrides).toEqual([]);
  });
});

describe("GET /api/allocation/drift", () => {
  function seedHoldings() {
    db.prepare(
      `INSERT INTO items (item_id, access_token, institution_name, linked_at)
       VALUES (?, ?, ?, ?)`
    ).run("item-inv", "access-inv", "Fidelity", "2026-08-24T00:00:00Z");
    db.prepare(`INSERT INTO sync_meta (item_id) VALUES (?)`).run("item-inv");
    db.prepare(
      `INSERT INTO securities (
         security_id, ticker_symbol, name, type, close_price, close_price_as_of,
         iso_currency_code, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sec-aapl", "AAPL", "Apple", "equity", null, null, "USD", "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO securities (
         security_id, ticker_symbol, name, type, close_price, close_price_as_of,
         iso_currency_code, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sec-cash", null, "Cash", "cash", null, null, "USD", "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO holdings (
         account_id, security_id, item_id, quantity, institution_price,
         institution_value, cost_basis, iso_currency_code, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("acct-inv", "sec-aapl", "item-inv", 10, 60, 600, null, "USD", "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO holdings (
         account_id, security_id, item_id, quantity, institution_price,
         institution_value, cost_basis, iso_currency_code, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("acct-inv", "sec-cash", "item-inv", null, null, 400, null, "USD", "2026-08-24T00:00:00Z");
  }

  test("returns current allocation with null targets when none are set", async () => {
    seedHoldings();

    const res = await request(app).get("/api/allocation/drift");
    expect(res.status).toBe(200);
    expect(res.body.total_value).toBe(1000);
    const us = res.body.buckets.find((b: any) => b.bucket === "us_stocks");
    expect(us).toMatchObject({
      target_pct: null,
      current_value: 600,
      drift_pct: null,
    });
    expect(us.current_pct).toBeCloseTo(60);
  });

  test("returns drift when targets are set", async () => {
    seedHoldings();
    db.prepare(
      `INSERT INTO target_allocations (bucket, target_pct, updated_at) VALUES (?, ?, ?)`
    ).run("us_stocks", 70, "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO target_allocations (bucket, target_pct, updated_at) VALUES (?, ?, ?)`
    ).run("cash", 30, "2026-08-24T00:00:00Z");

    const res = await request(app).get("/api/allocation/drift");
    expect(res.status).toBe(200);
    const us = res.body.buckets.find((b: any) => b.bucket === "us_stocks");
    expect(us.drift_pct).toBeCloseTo(-10);
    expect(us.drift_value).toBeCloseTo(-100);
  });

  test("suggest_deposit is included when ?deposit is passed", async () => {
    seedHoldings();
    db.prepare(
      `INSERT INTO target_allocations (bucket, target_pct, updated_at) VALUES (?, ?, ?)`
    ).run("us_stocks", 70, "2026-08-24T00:00:00Z");
    db.prepare(
      `INSERT INTO target_allocations (bucket, target_pct, updated_at) VALUES (?, ?, ?)`
    ).run("cash", 30, "2026-08-24T00:00:00Z");

    const res = await request(app).get("/api/allocation/drift?deposit=200");
    expect(res.status).toBe(200);
    expect(res.body.suggest_deposit.amount).toBe(200);
    expect(res.body.suggest_deposit.allocations.length).toBeGreaterThan(0);
  });

  test("rejects a bad deposit query", async () => {
    const res = await request(app).get("/api/allocation/drift?deposit=nope");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative/);
  });

  test("with no linked items returns an empty result", async () => {
    const res = await request(app).get("/api/allocation/drift");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total_value: 0,
      buckets: [],
      unclassified: [],
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
