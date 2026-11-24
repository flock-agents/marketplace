import { parseSvg, serializeSvg, svgViolations, type SvgNode } from "./svg-allowlist";
import { loadRawObject, objectPaths, rawObject } from "./objects-source";
export const PALETTE: Record<string, string> = {
  "#1d1b16": "ink", "#fffdf8": "paper", "#f5c95c": "yellow", "#f2994a": "orange", "#e8603f": "coral", "#9cc3e6": "blue", "#9cc5a1": "green",
  "#cfe6d2": "green-soft", "#d9b38c": "tan", "#c9a27a": "brown", "#e6dfd2": "stone", "#f3b8a6": "pink", "#2a2925": "dark", "#ffffff": "white",
};
const cache = new Map<string, string | null>();
export function objectNames(): string[] {
  return objectPaths().map((p) => p.split("/").pop()!.replace(/\.svg$/, "")).filter((n) => !n.startsWith("__")).sort();
}
const THEME_ATTRS: ReadonlySet<string> = new Set(["style", "aria-hidden", "focusable"]);
function themeNode(n: SvgNode): SvgNode {
  const attrs = { ...n.attrs };
  for (const k of ["stroke", "fill"]) {
    const v = attrs[k]?.toLowerCase();
    if (v === "#1d1b16") attrs[k] = "currentColor";
    else if (k === "fill" && v && PALETTE[v]) { delete attrs.fill; attrs.style = `fill:var(--obj-${PALETTE[v]})`; }
  }
  return { name: n.name, attrs, children: n.children.map(themeNode) };
}
/** Themed markup is re-serialised from the checked tree, never the raw string. Throws on anything the allowlist refuses. */
export function themeSvg(raw: string): string {
  const bad = svgViolations(raw);
  if (bad.length) throw new Error(`unsafe svg: ${bad.join("; ")}`);
  const root = themeNode(parseSvg(raw));
  root.attrs["aria-hidden"] = "true"; root.attrs.focusable = "false";
  return serializeSvg(root, THEME_ATTRS);
}
/** The one safe path to themed markup, for ObjectIcon and the review gallery: markup, or the violations that blocked it. */
export function checkedThemeSvg(raw: string): { svg: string } | { blocked: string[] } {
  try { return { svg: themeSvg(raw) }; } catch (e) { return { blocked: [(e as Error).message.replace(/^unsafe svg: /, "")] }; }
}
const pathOf = (name: string) => objectPaths().find((p) => p.endsWith(`/${name}.svg`));
/** A picture's themed markup, or null: no such picture, its markup is unsafe, or (in the chat frame) it is not loaded yet. */
export function objectSvg(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const path = pathOf(name);
  const raw = path ? rawObject(path) : null;
  if (raw === undefined) return null;   // not loaded yet: loadObjectSvg
  const checked = raw ? checkedThemeSvg(raw) : null;  // defence in depth: an edited app copy is re-checked
  const safe = checked && "svg" in checked ? checked.svg : null;
  cache.set(name, safe); return safe;
}
/** Whether a name draws a picture: it is one, and its markup is safe (unknown until loaded, so true while loading). */
export function objectKnown(name: string): boolean {
  const path = pathOf(name);
  if (!path) return false;
  return rawObject(path) === undefined ? true : objectSvg(name) !== null;
}
/** Loads a picture (the chat frame fetches each on first use; in an app all are in the script) and returns objectSvg's answer. */
export async function loadObjectSvg(name: string): Promise<string | null> {
  const path = pathOf(name);
  if (!path) return null;
  await loadRawObject(path);
  return objectSvg(name);
}
