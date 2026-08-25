import { describe, test, expect, beforeEach } from "vitest";
import { db } from "../db";
import {
  ASSET_BUCKETS,
  deleteBucketOverride,
  getBucketOverrides,
  getTargetAllocations,
  setBucketOverride,
  setTargetAllocations,
} from "../store";

beforeEach(() => {
  db.exec(`
    DELETE FROM target_allocations;
    DELETE FROM security_bucket_overrides;
  `);
});

describe("target allocations", () => {
  test("starts empty", () => {
    expect(getTargetAllocations()).toEqual([]);
  });

  test("stores and reads back a valid allocation set", () => {
    setTargetAllocations([
      { bucket: "us_stocks", target_pct: 60 },
      { bucket: "intl_stocks", target_pct: 20 },
      { bucket: "bonds", target_pct: 15 },
      { bucket: "cash", target_pct: 5 },
    ]);

    const rows = getTargetAllocations();
    expect(rows).toHaveLength(4);
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r.target_pct]));
    expect(byBucket).toEqual({
      us_stocks: 60,
      intl_stocks: 20,
      bonds: 15,
      cash: 5,
    });
    for (const r of rows) expect(r.updated_at).toMatch(/T/);
  });

  test("replaces prior targets on subsequent writes", () => {
    setTargetAllocations([
      { bucket: "us_stocks", target_pct: 70 },
      { bucket: "bonds", target_pct: 30 },
    ]);
    setTargetAllocations([
      { bucket: "us_stocks", target_pct: 100 },
    ]);

    const rows = getTargetAllocations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket: "us_stocks", target_pct: 100 });
  });

  test("empty array clears targets", () => {
    setTargetAllocations([{ bucket: "us_stocks", target_pct: 100 }]);
    setTargetAllocations([]);
    expect(getTargetAllocations()).toEqual([]);
  });

  test("tolerates tiny float slack in the sum", () => {
    // 33.33 + 33.33 + 33.34 = 100.00 exactly, but 33.33*3 + 0.01 style
    // rounding is what real UIs produce.
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: 33.33 },
        { bucket: "intl_stocks", target_pct: 33.33 },
        { bucket: "bonds", target_pct: 33.34 },
      ])
    ).not.toThrow();
  });

  test("rejects sums that don't equal 100", () => {
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: 60 },
        { bucket: "bonds", target_pct: 30 },
      ])
    ).toThrow(/sum to 100/);
    expect(getTargetAllocations()).toEqual([]);
  });

  test("rejects unknown bucket names", () => {
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: 50 },
        { bucket: "crypto", target_pct: 50 },
      ])
    ).toThrow(/Unknown bucket: crypto/);
    expect(getTargetAllocations()).toEqual([]);
  });

  test("rejects duplicate buckets", () => {
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: 50 },
        { bucket: "us_stocks", target_pct: 50 },
      ])
    ).toThrow(/Duplicate bucket: us_stocks/);
  });

  test("rejects negative or out-of-range percentages", () => {
    expect(() =>
      setTargetAllocations([{ bucket: "us_stocks", target_pct: -10 }])
    ).toThrow(/Invalid target_pct/);
    expect(() =>
      setTargetAllocations([{ bucket: "us_stocks", target_pct: 150 }])
    ).toThrow(/Invalid target_pct/);
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: Number.NaN },
      ])
    ).toThrow(/Invalid target_pct/);
  });

  test("rejects atomically — a partial write never lands", () => {
    setTargetAllocations([
      { bucket: "us_stocks", target_pct: 60 },
      { bucket: "bonds", target_pct: 40 },
    ]);
    expect(() =>
      setTargetAllocations([
        { bucket: "us_stocks", target_pct: 50 },
        { bucket: "crypto", target_pct: 50 },
      ])
    ).toThrow();
    // Prior targets remain untouched.
    const rows = getTargetAllocations();
    expect(rows).toHaveLength(2);
  });
});

describe("bucket overrides", () => {
  test("starts empty", () => {
    expect(getBucketOverrides()).toEqual([]);
  });

  test("stores and reads back an override", () => {
    setBucketOverride("BND", "bonds");
    const rows = getBucketOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker_symbol: "BND", bucket: "bonds" });
  });

  test("normalizes ticker to uppercase", () => {
    setBucketOverride("voo", "us_stocks");
    setBucketOverride(" vxus ", "intl_stocks");
    const rows = getBucketOverrides();
    expect(rows.map((r) => r.ticker_symbol).sort()).toEqual(["VOO", "VXUS"]);
  });

  test("upserts on repeated writes for the same ticker", () => {
    setBucketOverride("VOO", "us_stocks");
    setBucketOverride("voo", "intl_stocks");
    const rows = getBucketOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker_symbol: "VOO", bucket: "intl_stocks" });
  });

  test("delete removes an override, case-insensitively", () => {
    setBucketOverride("BND", "bonds");
    deleteBucketOverride("bnd");
    expect(getBucketOverrides()).toEqual([]);
  });

  test("delete of a missing ticker is a no-op", () => {
    expect(() => deleteBucketOverride("NOPE")).not.toThrow();
  });

  test("rejects empty ticker", () => {
    expect(() => setBucketOverride("   ", "bonds")).toThrow(
      /ticker_symbol is required/
    );
  });

  test("rejects unknown bucket", () => {
    expect(() => setBucketOverride("BND", "crypto")).toThrow(
      /Unknown bucket: crypto/
    );
  });

  test("exposes the canonical bucket list", () => {
    expect(ASSET_BUCKETS).toEqual([
      "us_stocks",
      "intl_stocks",
      "bonds",
      "cash",
      "other",
    ]);
  });
});
