import type { MouseEvent } from "react";

// Renders an "Open original ↗" link to the source thread, or nothing when there's no URL
// (never a dead link). Stops click propagation so it works inside clickable rows.
export function OpenOriginalLink({ url, className }: { url: string | null; className?: string }) {
  if (!url) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <a
      className={`open-original ${className ?? ""}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
    >
      Open original ↗
    </a>
  );
}
