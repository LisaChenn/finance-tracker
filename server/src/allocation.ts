import {
  ASSET_BUCKETS,
  type AssetBucket,
  type BucketOverride,
  type StoredHoldingRow,
  type TargetAllocation,
} from "./store";

export interface DriftBucket {
  bucket: AssetBucket;
  target_pct: number | null;
  current_value: number;
  current_pct: number;
  drift_pct: number | null;
  drift_value: number | null;
}

export interface UnclassifiedHolding {
  security_id: string;
  ticker_symbol: string | null;
  name: string | null;
  value: number;
}

export interface DepositAllocation {
  bucket: AssetBucket;
  buy: number;
}

export interface DepositSuggestion {
  amount: number;
  allocations: DepositAllocation[];
}

export interface DriftResult {
  total_value: number;
  buckets: DriftBucket[];
  unclassified: UnclassifiedHolding[];
  suggest_deposit?: DepositSuggestion;
}

// Prefer the institution's own valuation; fall back to qty × price. Mirrors
// the client's InvestmentsView so server and UI totals agree.
export function holdingValue(h: StoredHoldingRow): number {
  if (h.institution_value !== null && h.institution_value !== undefined) {
    return h.institution_value;
  }
  if (h.quantity !== null && h.institution_price !== null) {
    return h.quantity * h.institution_price;
  }
  return 0;
}

// Default bucket inferred from Plaid's coarse security.type. Anything the
// default can't confidently place (ETFs, mutual funds — both of which can hold
// stocks, bonds, or mixes) lands in `other` so it surfaces for the user to
// override intentionally.
function defaultBucketForType(type: string | null | undefined): AssetBucket {
  const t = (type ?? "").toLowerCase();
  if (t === "cash") return "cash";
  if (t === "fixed income") return "bonds";
  if (t === "equity") return "us_stocks";
  return "other";
}

interface Classification {
  bucket: AssetBucket;
  explicit: boolean; // true when an override applies
}

export function classifyHolding(
  h: StoredHoldingRow,
  overridesMap: Map<string, AssetBucket>
): Classification {
  const ticker = h.security.ticker_symbol?.toUpperCase() ?? null;
  if (ticker) {
    const override = overridesMap.get(ticker);
    if (override) return { bucket: override, explicit: true };
  }
  return { bucket: defaultBucketForType(h.security.type), explicit: false };
}

function suggestDeposit(
  buckets: DriftBucket[],
  amount: number,
  totalValue: number
): DepositSuggestion | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const targeted = buckets.filter((b) => b.target_pct !== null);
  if (targeted.length === 0) return undefined;

  const postTotal = totalValue + amount;
  const deficits = targeted.map((b) => ({
    bucket: b.bucket,
    deficit: Math.max(
      0,
      ((b.target_pct as number) / 100) * postTotal - b.current_value
    ),
  }));
  const totalDeficit = deficits.reduce((s, d) => s + d.deficit, 0);
  const targetSum = targeted.reduce(
    (s, b) => s + (b.target_pct as number),
    0
  );

  const byBucket = new Map<AssetBucket, number>();
  const add = (bucket: AssetBucket, buy: number): void => {
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + buy);
  };

  if (totalDeficit >= amount) {
    // Every dollar goes to an underweight bucket, proportional to how far
    // under it is. Post-deposit drift is minimized without any overshoot.
    for (const d of deficits) {
      if (d.deficit > 0) add(d.bucket, (d.deficit / totalDeficit) * amount);
    }
  } else if (totalDeficit > 0) {
    // Fill deficits first; then spread the leftover across all targeted
    // buckets by their target weights, so we don't tilt back into drift.
    for (const d of deficits) {
      if (d.deficit > 0) add(d.bucket, d.deficit);
    }
    const remaining = amount - totalDeficit;
    for (const b of targeted) {
      add(b.bucket, ((b.target_pct as number) / targetSum) * remaining);
    }
  } else {
    // Nothing is underweight — spread proportionally to targets so the ratio
    // holds.
    for (const b of targeted) {
      add(b.bucket, ((b.target_pct as number) / targetSum) * amount);
    }
  }

  const allocations: DepositAllocation[] = [];
  // Emit in the canonical bucket order so output is stable.
  for (const bucket of ASSET_BUCKETS) {
    const buy = byBucket.get(bucket);
    if (buy !== undefined && buy > 0) allocations.push({ bucket, buy });
  }
  return { amount, allocations };
}

export function computeDrift(
  holdings: StoredHoldingRow[],
  targets: TargetAllocation[],
  overrides: BucketOverride[],
  depositAmount?: number
): DriftResult {
  const overridesMap = new Map<string, AssetBucket>();
  for (const o of overrides) overridesMap.set(o.ticker_symbol, o.bucket);

  const targetsByBucket = new Map<AssetBucket, number>();
  for (const t of targets) targetsByBucket.set(t.bucket, t.target_pct);

  const valueByBucket = new Map<AssetBucket, number>();
  const unclassified: UnclassifiedHolding[] = [];
  let totalValue = 0;

  for (const h of holdings) {
    const value = holdingValue(h);
    if (value === 0) continue;
    totalValue += value;

    const { bucket, explicit } = classifyHolding(h, overridesMap);
    valueByBucket.set(bucket, (valueByBucket.get(bucket) ?? 0) + value);

    // Flag anything that landed in `other` by default (no override) so the
    // UI can prompt the user to classify it.
    if (bucket === "other" && !explicit) {
      unclassified.push({
        security_id: h.security_id,
        ticker_symbol: h.security.ticker_symbol,
        name: h.security.name,
        value,
      });
    }
  }

  // Emit any bucket that appears in holdings OR targets — union, canonical
  // order — so the UI doesn't have to fill gaps.
  const bucketsInPlay = new Set<AssetBucket>([
    ...valueByBucket.keys(),
    ...targetsByBucket.keys(),
  ]);

  const buckets: DriftBucket[] = [];
  for (const bucket of ASSET_BUCKETS) {
    if (!bucketsInPlay.has(bucket)) continue;
    const current_value = valueByBucket.get(bucket) ?? 0;
    const current_pct = totalValue > 0 ? (current_value / totalValue) * 100 : 0;
    const target_pct = targetsByBucket.has(bucket)
      ? (targetsByBucket.get(bucket) as number)
      : null;
    const drift_pct = target_pct === null ? null : current_pct - target_pct;
    const drift_value =
      target_pct === null
        ? null
        : current_value - (target_pct / 100) * totalValue;
    buckets.push({
      bucket,
      target_pct,
      current_value,
      current_pct,
      drift_pct,
      drift_value,
    });
  }

  // Sort unclassified largest-first — the biggest positions are the ones that
  // most distort the picture until they're classified.
  unclassified.sort((a, b) => b.value - a.value);

  const suggest_deposit =
    depositAmount !== undefined
      ? suggestDeposit(buckets, depositAmount, totalValue)
      : undefined;

  return {
    total_value: totalValue,
    buckets,
    unclassified,
    ...(suggest_deposit ? { suggest_deposit } : {}),
  };
}
