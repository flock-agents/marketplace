// The chat block frame's object pictures (vite.chat-frame.config.ts swaps objects-source.ts for this): the names are in
// the script, each picture's SVG is its own small file, fetched the first time a block shows it.
let LOAD: Record<string, () => Promise<string>> = {};
try { LOAD = import.meta.glob("../objects/*.svg", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>; }
catch { /* bun without vite: no objects */ }
const loaded = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function objectPaths(): string[] { return Object.keys(LOAD); }
export function rawObject(path: string): string | undefined { return loaded.get(path); }
export function loadRawObject(path: string): Promise<string | null> {
  const have = loaded.get(path);
  if (have !== undefined) return Promise.resolve(have);
  let p = pending.get(path);
  if (!p) {
    p = (LOAD[path]?.() ?? Promise.resolve(null)).then((raw) => { if (raw != null) loaded.set(path, raw); return raw ?? null; }, () => null);
    pending.set(path, p);
    void p.then(() => pending.delete(path));
  }
  return p;
}
