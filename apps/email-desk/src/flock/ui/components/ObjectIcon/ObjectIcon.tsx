import { useEffect, useLayoutEffect, useState } from "react";
import "./object-icon.css";
import { loadObjectSvg, objectKnown, objectSvg } from "../../objects-index";
import { ensureGloss } from "./gloss";
const warned = new Set<string>();
export function ObjectIcon({ name, size = 48, label }: { name: string; size?: 24|32|48|64|96; label?: string }) {
  useLayoutEffect(ensureGloss, []);
  const [, loaded] = useState(0);
  if ((size as number) < 24 && !warned.has("size")) { warned.add("size"); console.warn("ObjectIcon below 24px: use <Icon> (lucide) instead"); }
  const svg = objectSvg(name);
  // In the chat frame a picture loads on first use (objects-source.lazy.ts); in an app it is always here and this does nothing.
  const loading = !svg && objectKnown(name);
  useEffect(() => {
    if (!loading) return;
    let live = true;
    void loadObjectSvg(name).then(() => { if (live) loaded((n) => n + 1); });
    return () => { live = false; };
  }, [name, loading]);
  // The same tile, empty, while it loads: nothing moves when the picture lands.
  if (loading) return <span className="fl-obj" data-size={size} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} />;
  if (!svg) { if (!warned.has(name)) { warned.add(name); console.warn(`ObjectIcon: no object "${name}" in src/flock/objects`); } return null; }
  return <span className="fl-obj" data-size={size} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label}
    dangerouslySetInnerHTML={{ __html: svg }} />;
}
