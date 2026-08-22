import { useCallback, useEffect, useRef, useState } from "react";

export interface SyncStatusItem {
  item_id: string;
  institution_name: string;
  accounts_fetched_at: string | null;
  transactions_fetched_at: string | null;
  transactions_last_error: string | null;
}

type Field = "accounts_fetched_at" | "transactions_fetched_at";

interface Options {
  field: Field;
  onBump: () => void;
}

export function useSyncPoller({ field, onBump }: Options) {
  const [active, setActive] = useState(false);
  const baselineRef = useRef<Map<string, string | null>>(new Map());
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const onBumpRef = useRef(onBump);

  useEffect(() => {
    onBumpRef.current = onBump;
  }, [onBump]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActive(false);
  }, []);

  const tick = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      const data = (await res.json()) as { items: SyncStatusItem[] };
      let bumped = false;
      for (const item of data.items) {
        const baseline = baselineRef.current.get(item.item_id) ?? null;
        const current = item[field];
        if (current && current !== baseline) {
          bumped = true;
        }
      }
      if (bumped) {
        // Update baseline so we don't fire again for the same value
        for (const item of data.items) {
          baselineRef.current.set(item.item_id, item[field]);
        }
        onBumpRef.current();
      }
    } catch (err) {
      console.error("[useSyncPoller] status fetch failed", err);
    }

    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed > 30_000) {
      stop();
      return;
    }
    const nextDelay = elapsed < 15_000 ? 1_000 : 3_000;
    timerRef.current = window.setTimeout(tick, nextDelay);
  }, [field, stop]);

  const start = useCallback(async () => {
    // Snapshot current timestamps as the baseline; only bump if a value later differs.
    try {
      const res = await fetch("/api/sync/status");
      const data = (await res.json()) as { items: SyncStatusItem[] };
      baselineRef.current = new Map(
        data.items.map((i) => [i.item_id, i[field]])
      );
    } catch (err) {
      console.error("[useSyncPoller] baseline fetch failed", err);
      baselineRef.current = new Map();
    }
    startedAtRef.current = Date.now();
    setActive(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(tick, 1_000);
  }, [field, tick]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return { start, stop, active };
}
