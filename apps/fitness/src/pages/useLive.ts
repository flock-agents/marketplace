import { useCallback, useEffect, useRef, useState } from "react";
import { kitFetch, subscribeEvents } from "../flock/ui";

/** One of the app's own JSON routes (`path` under /api), fetched again whenever a row of `tables` changes. */
export function useLive<T>(path: string, tables: readonly string[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);   // only the latest fetch may land
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await kitFetch<T>(path);
      if (mine === seq.current) { setData(r); setError(null); }
    } catch (e) { if (mine === seq.current) setError((e as Error).message); }
  }, [path]);
  useEffect(() => { void refetch(); }, [refetch]);
  const key = tables.join(",");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    return subscribeEvents((e) => { if (tables.includes(e.table)) soon(); }, soon);
  }, [refetch, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, refetch };
}
