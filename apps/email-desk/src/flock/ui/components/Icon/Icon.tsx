import { resolveIcon } from "./icon-map";

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = resolveIcon(name);
  return C ? <C size={size} aria-hidden strokeWidth={1.8} /> : null;
}
