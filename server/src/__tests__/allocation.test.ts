import { describe, test, expect } from "vitest";
import { classifyHolding, computeDrift, holdingValue } from "../allocation";
import type {
  BucketOverride,
  StoredHoldingRow,
  TargetAllocation,
} from "../store";

function h(overrides: Partial<StoredHoldingRow> = {}): StoredHoldingRow {
  return {
    account_id: "a1",
    security_id: "sec-1",
    quantity: null,
    institution_price: null,
    institution_value: null,
    cost_basis: null,
    iso_currency_code: "USD",
    security: {
      ticker_symbol: null,
      name: null,
      type: null,
      close_price: null,
      close_price_as_of: null,
      iso_currency_code: "USD",
    },
    ...overrides,
  };
}

function stock(ticker: string, value: number): StoredHoldingRow {
  return h({
    security_id: `sec-${ticker}`,
    institution_value: value,
    security: {
      ticker_symbol: ticker,
      name: ticker,
      type: "equity",
      close_price: null,
      close_price_as_of: null,
      iso_currency_code: "USD",
    },
  });
}

function etf(ticker: string, value: number): StoredHoldingRow {
  return h({
    security_id: `sec-${ticker}`,
    institution_value: value,
    security: {
      ticker_symbol: ticker,
      name: ticker,
      type: "etf",
      close_price: null,
      close_price_as_of: null,
      iso_currency_code: "USD",
    },
  });
}

function cashHolding(value: number, id = "cash-1"): StoredHoldingRow {
  return h({
    security_id: id,
    institution_value: value,
    security: {
      ticker_symbol: null,
      name: "Cash",
      type: "cash",
      close_price: null,
      close_price_as_of: null,
      iso_currency_code: "USD",
    },
  });
}

const targets = (
  m: Partial<Record<string, number>>
): TargetAllocation[] =>
  Object.entries(m).map(([bucket, target_pct]) => ({
    bucket: bucket as TargetAllocation["bucket"],
    target_pct: target_pct as number,
    updated_at: "2026-01-01T00:00:00Z",
  }));

const overrides = (
  m: Record<string, string>
): BucketOverride[] =>
  Object.entries(m).map(([ticker_symbol, bucket]) => ({
    ticker_symbol,
    bucket: bucket as BucketOverride["bucket"],
    updated_at: "2026-01-01T00:00:00Z",
  }));

describe("holdingValue", () => {
  test("prefers institution_value", () => {
    expect(
      holdingValue(h({ institution_value: 500, quantity: 3, institution_price: 100 }))
    ).toBe(500);
  });

  test("falls back to qty × price", () => {
    expect(
      holdingValue(h({ institution_value: null, quantity: 3, institution_price: 100 }))
    ).toBe(300);
  });

  test("returns 0 when neither is available", () => {
    expect(holdingValue(h())).toBe(0);
  });
});

describe("classifyHolding — defaults from security.type", () => {
  test("equity → us_stocks", () => {
    expect(classifyHolding(stock("AAPL", 100), new Map())).toEqual({
      bucket: "us_stocks",
      explicit: false,
    });
  });

  test("cash → cash", () => {
    expect(classifyHolding(cashHolding(50), new Map())).toEqual({
      bucket: "cash",
      explicit: false,
    });
  });

  test("fixed income → bonds", () => {
    const bond = h({
      institution_value: 100,
      security: {
        ...h().security,
        ticker_symbol: "T-BILL",
        type: "fixed income",
      },
    });
    expect(classifyHolding(bond, new Map())).toEqual({
      bucket: "bonds",
      explicit: false,
    });
  });

  test("ETF defaults to `other` (needs override — could be stocks or bonds)", () => {
    expect(classifyHolding(etf("VOO", 100), new Map())).toEqual({
      bucket: "other",
      explicit: false,
    });
  });

  test("unknown types default to `other`", () => {
    const derivative = h({
      institution_value: 100,
      security: { ...h().security, ticker_symbol: "X", type: "derivative" },
    });
    expect(classifyHolding(derivative, new Map())).toEqual({
      bucket: "other",
      explicit: false,
    });
  });
});

describe("classifyHolding — ticker override wins", () => {
  test("override applies (case-insensitively on ticker)", () => {
    const map = new Map([["VOO", "us_stocks" as const]]);
    expect(classifyHolding(etf("voo", 100), map)).toEqual({
      bucket: "us_stocks",
      explicit: true,
    });
  });

  test("override wins even for a security type that would default elsewhere", () => {
    // AAPL is `equity` (would default to us_stocks), but user calls it intl.
    const map = new Map([["AAPL", "intl_stocks" as const]]);
    expect(classifyHolding(stock("AAPL", 100), map)).toEqual({
      bucket: "intl_stocks",
      explicit: true,
    });
  });
});

describe("computeDrift — basics", () => {
  test("empty inputs → zeroed result", () => {
    expect(computeDrift([], [], [])).toEqual({
      total_value: 0,
      buckets: [],
      unclassified: [],
    });
  });

  test("holdings without targets — buckets present, targets/drift null", () => {
    const r = computeDrift(
      [stock("AAPL", 600), cashHolding(400)],
      [],
      []
    );
    expect(r.total_value).toBe(1000);
    expect(r.buckets).toEqual([
      {
        bucket: "us_stocks",
        target_pct: null,
        current_value: 600,
        current_pct: 60,
        drift_pct: null,
        drift_value: null,
      },
      {
        bucket: "cash",
        target_pct: null,
        current_value: 400,
        current_pct: 40,
        drift_pct: null,
        drift_value: null,
      },
    ]);
  });

  test("computes drift when both current and target exist", () => {
    const r = computeDrift(
      [stock("AAPL", 580), cashHolding(420)],
      targets({ us_stocks: 60, cash: 40 }),
      []
    );
    expect(r.total_value).toBe(1000);
    const us = r.buckets.find((b) => b.bucket === "us_stocks")!;
    expect(us.current_pct).toBeCloseTo(58);
    expect(us.drift_pct).toBeCloseTo(-2);
    expect(us.drift_value).toBeCloseTo(-20);
    const cash = r.buckets.find((b) => b.bucket === "cash")!;
    expect(cash.drift_pct).toBeCloseTo(2);
    expect(cash.drift_value).toBeCloseTo(20);
  });

  test("target with no matching holdings shows current 0 and full negative drift", () => {
    const r = computeDrift(
      [stock("AAPL", 1000)],
      targets({ us_stocks: 60, bonds: 40 }),
      []
    );
    const bonds = r.buckets.find((b) => b.bucket === "bonds")!;
    expect(bonds.current_value).toBe(0);
    expect(bonds.current_pct).toBe(0);
    expect(bonds.drift_pct).toBeCloseTo(-40);
    expect(bonds.drift_value).toBeCloseTo(-400);
  });

  test("buckets emitted in canonical order", () => {
    const r = computeDrift(
      [
        cashHolding(100),
        stock("AAPL", 100),
        etf("VXUS", 100), // override → intl
      ],
      targets({ us_stocks: 34, intl_stocks: 33, cash: 33 }),
      overrides({ VXUS: "intl_stocks" })
    );
    expect(r.buckets.map((b) => b.bucket)).toEqual([
      "us_stocks",
      "intl_stocks",
      "cash",
    ]);
  });

  test("zero-value holdings are ignored", () => {
    const r = computeDrift(
      [stock("AAPL", 1000), stock("EMPTY", 0)],
      [],
      []
    );
    expect(r.total_value).toBe(1000);
    expect(r.unclassified).toEqual([]);
  });
});

describe("computeDrift — unclassified surfacing", () => {
  test("ETFs without an override land in `other` and are flagged", () => {
    const r = computeDrift([etf("ARKK", 800), etf("VOO", 600)], [], []);
    expect(r.unclassified).toHaveLength(2);
    // Sorted largest-first.
    expect(r.unclassified[0].ticker_symbol).toBe("ARKK");
    expect(r.unclassified[1].ticker_symbol).toBe("VOO");
  });

  test("an explicit `other` override does NOT flag as unclassified", () => {
    // User deliberately parked GLD in `other` — we respect that.
    const r = computeDrift(
      [etf("GLD", 500)],
      [],
      overrides({ GLD: "other" })
    );
    expect(r.unclassified).toEqual([]);
    expect(r.buckets[0]).toMatchObject({ bucket: "other", current_value: 500 });
  });

  test("override into a real bucket removes the unclassified flag", () => {
    const r = computeDrift(
      [etf("VOO", 500)],
      [],
      overrides({ VOO: "us_stocks" })
    );
    expect(r.unclassified).toEqual([]);
  });
});

describe("computeDrift — deposit suggestion", () => {
  test("undefined deposit → no suggestion field", () => {
    const r = computeDrift([stock("AAPL", 1000)], targets({ us_stocks: 100 }), []);
    expect(r.suggest_deposit).toBeUndefined();
  });

  test("deposit but no targets → no suggestion", () => {
    const r = computeDrift([stock("AAPL", 1000)], [], [], 500);
    expect(r.suggest_deposit).toBeUndefined();
  });

  test("zero or negative deposit → no suggestion", () => {
    const t = targets({ us_stocks: 100 });
    expect(computeDrift([stock("AAPL", 1000)], t, [], 0).suggest_deposit).toBeUndefined();
    expect(computeDrift([stock("AAPL", 1000)], t, [], -50).suggest_deposit).toBeUndefined();
  });

  test("deposit fully absorbed by deficits — proportional to how underweight each is", () => {
    // Current: $600 us_stocks, $400 cash. Total $1000.
    // Targets: 60% us_stocks, 15% bonds, 25% cash.
    // Post-deposit total = $2000. Desired: us $1200, bonds $300, cash $500.
    // Deficits: us $600, bonds $300, cash $100. Sum = $1000 = deposit.
    // Buys should exactly match deficits.
    const r = computeDrift(
      [stock("AAPL", 600), cashHolding(400)],
      targets({ us_stocks: 60, bonds: 15, cash: 25 }),
      [],
      1000
    );
    const s = r.suggest_deposit!;
    expect(s.amount).toBe(1000);
    const byBucket = Object.fromEntries(s.allocations.map((a) => [a.bucket, a.buy]));
    expect(byBucket.us_stocks).toBeCloseTo(600);
    expect(byBucket.bonds).toBeCloseTo(300);
    expect(byBucket.cash).toBeCloseTo(100);
    // Sums to exactly the deposit.
    const sum = s.allocations.reduce((n, a) => n + a.buy, 0);
    expect(sum).toBeCloseTo(1000);
  });

  test("deposit larger than total deficit — deficits filled, remainder spread by target weights", () => {
    // Current: $600 us_stocks, $400 cash. Total $1000.
    // Targets: 60% us_stocks, 40% cash.
    // Post-deposit total for a $500 deposit = $1500.
    // Desired: us $900, cash $600. Deficits: us $300, cash $200. Total deficit $500.
    // Deposit $2000 → fills $500 of deficit, $1500 remainder split 60/40 → us +$900, cash +$600.
    // Final buys: us $1200, cash $800.
    const r = computeDrift(
      [stock("AAPL", 600), cashHolding(400)],
      targets({ us_stocks: 60, cash: 40 }),
      [],
      2000
    );
    const s = r.suggest_deposit!;
    const byBucket = Object.fromEntries(s.allocations.map((a) => [a.bucket, a.buy]));
    expect(byBucket.us_stocks).toBeCloseTo(1200);
    expect(byBucket.cash).toBeCloseTo(800);
  });

  test("nothing underweight — spread proportionally to targets", () => {
    // Perfectly on target: 60/40 with $1000 total.
    const r = computeDrift(
      [stock("AAPL", 600), cashHolding(400)],
      targets({ us_stocks: 60, cash: 40 }),
      [],
      1000
    );
    const s = r.suggest_deposit!;
    const byBucket = Object.fromEntries(s.allocations.map((a) => [a.bucket, a.buy]));
    expect(byBucket.us_stocks).toBeCloseTo(600);
    expect(byBucket.cash).toBeCloseTo(400);
  });

  test("allocations exclude buckets that receive $0", () => {
    // Cash is way overweight — deposit shouldn't go into cash.
    const r = computeDrift(
      [stock("AAPL", 100), cashHolding(900)],
      targets({ us_stocks: 60, cash: 40 }),
      [],
      100
    );
    const s = r.suggest_deposit!;
    expect(s.allocations.every((a) => a.buy > 0)).toBe(true);
    expect(s.allocations.some((a) => a.bucket === "cash")).toBe(false);
  });
});
