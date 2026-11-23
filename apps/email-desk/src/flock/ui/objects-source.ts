// The object pictures' raw SVG, every one in the script (apps). The chat block frame swaps this module for
// objects-source.lazy.ts (vite.chat-frame.config.ts): the names stay in its script, each picture loads when a block uses it.
// Vite resolves the glob at build time. In an app: src/flock/ui/objects-source.ts → src/flock/objects/*.svg.
// In the library repo: packages/ui/src/objects-source.ts → packages/ui/objects/*.svg (same relative path).
let RAW: Record<string, string> = {};
// Vite finds the call only as written, so no cast; the server typechecks this file without Vite's types.
// @ts-ignore -- `glob` is unknown to ImportMeta outside Vite (an error there, none in the frontend)
try { RAW = import.meta.glob("../objects/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>; }
catch { /* bun without vite (gen script): no objects */ }

/** The pictures' file paths ("../objects/<name>.svg"). */
export function objectPaths(): string[] { return Object.keys(RAW); }
/** A picture's raw SVG: undefined while it is not loaded (never, here: all are). */
export function rawObject(path: string): string | undefined { return RAW[path]; }
/** Loads a picture's raw SVG (already here). */
export function loadRawObject(path: string): Promise<string | null> { return Promise.resolve(RAW[path] ?? null); }
