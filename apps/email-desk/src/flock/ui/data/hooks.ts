import { useCallback, useEffect, useRef, useState } from "react";
import { kitFetch, subscribeEvents, KitError } from "./client";
import { useToast } from "../components/Toast/Toast";

export type Where = Record<string, string | number | boolean | null>;
export interface TableQuery { where?: Where; sort?: string; limit?: number; q?: string }
type Page<R> = { rows: R[]; nextCursor: string | null };

function qs(q: TableQuery = {}, cursor?: string | null, limit?: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q.where ?? {})) v === null ? p.set(`${k}[null]`, "1") : p.set(k, String(v));
  if (q.sort) p.set("sort", q.sort);
  const lim = limit ?? q.limit; if (lim) p.set("limit", String(lim));
  if (q.q) p.set("q", q.q);
  if (cursor) p.set("cursor", cursor);
  const s = p.toString(); return s ? `?${s}` : "";
}
const message = (e: unknown) => (e instanceof KitError ? (e.field ? `${e.field}: ${e.message}` : e.message) : "Something went wrong");

export function useTable<R extends { id: string }>(table: string, query: TableQuery = {}) {
  const key = JSON.stringify(query);
  const [rows, setRows] = useState<R[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast(); const rowsRef = useRef(rows); rowsRef.current = rows;
  const seq = useRef(0);   // only the latest fetch may land
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      // Keep every page the user has loaded (up to the kit's maximum) so an edit does not snap the list back to page 1.
      const base = query.limit ?? 100, have = rowsRef.current.length;
      const r = await kitFetch<Page<R>>(`_data/${table}${qs(query, null, have > base ? Math.min(500, have) : undefined)}`);
      if (mine !== seq.current) return;
      setRows(r.rows); setCursor(r.nextCursor); setError(null);
    } catch (e) { if (mine === seq.current) setError(message(e)); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [table, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    const off = subscribeEvents((e) => { if (e.table === table) soon(); }, soon);
    return () => { clearTimeout(t); off(); };
  }, [table, refetch]);
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const mine = seq.current; setLoadingMore(true);   // a refetch in between resets the list; this page then belongs to the old cursor
    try {
      const r = await kitFetch<Page<R>>(`_data/${table}${qs(query, cursor)}`);
      if (mine !== seq.current) return;
      setRows((x) => [...x, ...r.rows.filter((n) => !x.some((o) => o.id === n.id))]); setCursor(r.nextCursor);
    } catch (e) { toast.show({ message: `Couldn't load more: ${message(e)}`, tone: "danger" }); }   // the loaded rows stay; Load more can be tried again
    finally { setLoadingMore(false); }
  }, [table, key, cursor, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps
  const fail = (e: unknown, rollback?: () => void): never => { rollback?.(); toast.show({ message: `Couldn't save: ${message(e)}`, tone: "danger" }); throw e; };
  const create = async (values: Partial<R>): Promise<R> => {
    try {
      const { row } = await kitFetch<{ row: R }>(`_data/${table}`, { method: "POST", body: JSON.stringify(values) });
      setRows((x) => [row, ...x.filter((r) => r.id !== row.id)]); return row;
    } catch (e) { return fail(e); }
  };
  const update = async (id: string, patch: Partial<R>): Promise<R> => {
    const before = rowsRef.current.find((r) => r.id === id);
    setRows((x) => x.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try { const { row } = await kitFetch<{ row: R }>(`_data/${table}/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); setRows((x) => x.map((r) => (r.id === id ? row : r))); return row; }
    catch (e) { return fail(e, () => { if (before) setRows((x) => x.map((r) => (r.id === id ? before : r))); }); }
  };
  /** Resolves with the change id, so an app can POST `_changes/<id>/undo` to bring back the same row. */
  const remove = async (id: string): Promise<string | undefined> => {
    const at = rowsRef.current.findIndex((r) => r.id === id), before = rowsRef.current[at];
    setRows((x) => x.filter((r) => r.id !== id));
    try { return (await kitFetch<{ changeId?: string } | null>(`_data/${table}/${id}`, { method: "DELETE" }))?.changeId; }
    catch (e) { return fail(e, () => { if (before) setRows((x) => (x.some((r) => r.id === id) ? x : [...x.slice(0, at), before, ...x.slice(at)])); }); }
  };
  return { rows, loading: loading || loadingMore, error, hasMore: !!cursor, loadMore, refetch, create, update, remove };
}

export function useRecord<R extends { id: string }>(table: string, id: string | null) {
  const [row, setRow] = useState<R | null>(null); const [loading, setLoading] = useState(!!id); const [error, setError] = useState<string | null>(null);
  const toast = useToast(); const rowRef = useRef(row); rowRef.current = row;
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!id) { setRow(null); setLoading(false); return; }
    try { const r = (await kitFetch<{ row: R }>(`_data/${table}/${id}`)).row; if (mine === seq.current) { setRow(r); setError(null); } }
    catch (e) { if (mine === seq.current) setError(message(e)); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [table, id]);
  useEffect(() => { setLoading(!!id); void load(); }, [load, id]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 150); };
    const off = subscribeEvents((e) => { if (e.table === table && e.id === id) soon(); }, soon);
    return () => { clearTimeout(t); off(); };
  }, [table, id, load]);
  const update = async (patch: Partial<R>): Promise<R> => {
    if (!id) throw new KitError(0, { error: "no_record", message: "No record selected" });
    const before = rowRef.current; setRow((r) => (r ? { ...r, ...patch } : r));
    try { const { row: next } = await kitFetch<{ row: R }>(`_data/${table}/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); setRow(next); return next; }
    catch (e) { setRow(before); toast.show({ message: `Couldn't save: ${message(e)}`, tone: "danger" }); throw e; }
  };
  return { row, loading, error, update };
}

export interface Me {
  viewer: string | null; anonymous?: boolean; agent: { id?: string; name?: string; avatar?: string } | null;
  /** The app's id in Flock (a kit older than this sends none). */
  appId?: string;
  /** false when this viewer has no agent in the app (its owner set their kind to "No agent"): the app shows no chat.
   *  Absent for everyone else, and from a kit or a Flock older than this. */
  chat?: boolean;
  [k: string]: unknown;
}
let mePromise: Promise<Me> | null = null;
/** Who is looking and which agent this app has (GET ./api/_me), fetched once per page. */
export function useMe(): Me & { loading: boolean } {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    mePromise ??= kitFetch<Me>("_me").catch((e) => { mePromise = null; throw e; });
    mePromise.then((m) => { if (live) setMe(m); }, () => {});
    return () => { live = false; };
  }, []);
  return { viewer: me?.viewer ?? null, agent: me?.agent ?? null, ...(me ?? {}), anonymous: me ? (me.anonymous ?? me.viewer === null) : true, loading: !me };
}

export interface AppDisplay { object?: string; accent?: string; labels?: Record<string, string>; starters?: string[]; [k: string]: unknown }
export interface AppInfo {
  name: string | null; icon: string | null; display: AppDisplay; settings: Record<string, unknown>;
  /** The icon the owner set for the app in Flock (an image URL, or an emoji), shown in AppShell's header in place of the object. */
  ownerIcon: string | null;
}
const NO_APP: AppInfo = { name: null, icon: null, display: {}, settings: {}, ownerIcon: null };
// One copy of GET ./api/_app per page, shared by every useApp and by label(). Reloaded on a `_settings` change event and
// after a reconnect, the latest response winning.
let appInfo: AppInfo | null = null;
let appSeq = 0, appInFlight: Promise<void> | null = null, appOff: (() => void) | null = null;
const appListeners = new Set<() => void>();
function loadApp(): Promise<void> {
  const mine = ++appSeq;
  const p = kitFetch<Partial<AppInfo>>("_app").then(
    (a) => ({ name: a?.name ?? null, icon: a?.icon ?? null, display: a?.display ?? {}, settings: a?.settings ?? {}, ownerIcon: a?.ownerIcon ?? null }),
    () => appInfo ?? NO_APP,   // an older kit with no /api/_app, or offline: keep what we have, else the template's fallbacks
  ).then((a) => { if (mine === appSeq) { appInfo = a; appListeners.forEach((f) => f()); } })
    .finally(() => { if (appInFlight === p) appInFlight = null; });
  appInFlight = p;
  return p;
}
function watchApp(listener: () => void): () => void {
  appListeners.add(listener);
  if (!appOff) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void loadApp(), 150); };
    const off = subscribeEvents((e) => { if (e.table === "_settings") soon(); }, soon);
    appOff = () => { clearTimeout(t); off(); };
  }
  if (!appInfo && !appInFlight) void loadApp();
  return () => { appListeners.delete(listener); if (!appListeners.size && appOff) { appOff(); appOff = null; } };
}
/** The app's name, icon, display (object, accent, labels, starters) and the owner's settings (GET ./api/_app). Fetched once
 *  per page, and again when a setting changes. Until it loads (or on a kit without it), display and settings are empty, so
 *  pass the template's own values as fallbacks: `app.display.accent ?? "teal"`. */
export function useApp(): AppInfo & { loading: boolean } {
  const [, bump] = useState(0);
  useEffect(() => watchApp(() => bump((n) => n + 1)), []);
  const a = appInfo ?? NO_APP;
  return { ...a, loading: !appInfo };
}
/** A display label the owner may have renamed (`display.labels[key]`), else the fallback. Call `useApp()` in the component
 *  (App.tsx is enough), so labels re-render when the app info loads or changes. */
export function label(key: string, fallback: string): string {
  const v = appInfo?.display.labels?.[key];
  return typeof v === "string" && v.trim() ? v : fallback;
}

export interface ClearResult { groupId: string | null; cleared: number; kept: { table: string; count: number; reason: string }[] }
/** Sample rows still in the app (`samples` from GET ./api/_data/_schema), followed live. `clear()` runs Clear samples and
 *  toasts what was cleared and kept, with Undo (focused, since the banner's button goes away). AppShell's banner uses it; an app rarely needs it directly. */
export function useSamples() {
  const [tables, setTables] = useState<Record<string, number>>({});
  const toast = useToast();
  const seq = useRef(0);
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await kitFetch<{ samples?: Record<string, number> }>("_data/_schema");
      if (mine === seq.current) setTables(s?.samples && typeof s.samples === "object" ? s.samples : {});
    } catch { if (mine === seq.current) setTables({}); }   // no kit schema here: no samples to show
  }, []);
  useEffect(() => {
    void refetch();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    const off = subscribeEvents(soon, soon);   // any write may add, edit (unmark) or clear a sample
    return () => { clearTimeout(t); off(); };
  }, [refetch]);
  const undo = async (groupId: string) => {
    try { await kitFetch(`_data/_changes/groups/${encodeURIComponent(groupId)}/undo`, { method: "POST" }); }
    catch (e) { toast.show({ message: `Couldn't undo: ${message(e)}`, tone: "danger" }); }
    finally { void refetch(); }
  };
  const clear = async (): Promise<ClearResult | null> => {
    let r: ClearResult;
    try { r = await kitFetch<ClearResult>("_data/_samples/clear", { method: "POST" }); }
    catch (e) { toast.show({ message: `Couldn't clear samples: ${message(e)}`, tone: "danger" }); return null; }
    setTables({}); void refetch();
    const n = r.cleared ?? 0;
    const kept = (r.kept ?? []).map((k) => `Kept ${k.count} in ${label(k.table, k.table)}, ${k.reason}.`).join(" ");
    toast.show({
      message: [`Cleared ${n} sample ${n === 1 ? "row" : "rows"}.`, kept].filter(Boolean).join(" "), tone: "success",
      action: r.groupId ? { label: "Undo", onClick: () => void undo(r.groupId!), focus: true } : undefined,
    });
    return r;
  };
  const total = Object.values(tables).reduce((a, b) => a + (Number(b) || 0), 0);
  return { tables, total, clear, refetch };
}


export interface OwnerRemoval { groupId: string; by: string; count: number; tables: string[]; at: string }
const DISMISSED_KEY = "fl-owner-removals-dismissed";
/** Dismissal is of this many removed rows: more deletes into the same group show the notice again. */
const key = (r: { groupId: string; count: number }) => `${r.groupId}#${r.count}`;
const readDismissed = (): string[] => { try { const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
/** Rows an agent removed that the owner had written (the kit groups them, `GET _data/_changes/owner-removals`), followed live. `undo(groupId)` puts
 *  them back; `dismiss(groupId)` hides one on this device. AppShell's notice uses it. */
export function useOwnerRemovals() {
  const [all, setAll] = useState<OwnerRemoval[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const toast = useToast();
  const seq = useRef(0);
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await kitFetch<{ removals?: OwnerRemoval[] }>("_data/_changes/owner-removals");
      if (mine === seq.current) setAll(Array.isArray(r?.removals) ? r.removals : []);
    } catch { if (mine === seq.current) setAll([]); }   // an anonymous viewer, or no kit here: no notice
  }, []);
  useEffect(() => {
    void refetch();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    const off = subscribeEvents(soon, soon);
    return () => { clearTimeout(t); off(); };
  }, [refetch]);
  const undo = async (groupId: string) => {
    try { await kitFetch(`_data/_changes/groups/${encodeURIComponent(groupId)}/undo`, { method: "POST" }); }
    catch (e) { toast.show({ message: `Couldn't undo: ${message(e)}`, tone: "danger" }); }
    finally { void refetch(); }
  };
  const dismiss = (groupId: string) => {
    const next = [...new Set([...dismissed, key(all.find((r) => r.groupId === groupId) ?? { groupId, count: 0 })])].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage blocked: hidden for this visit */ }
  };
  return { removals: all.filter((r) => !dismissed.includes(key(r))), undo, dismiss };
}
