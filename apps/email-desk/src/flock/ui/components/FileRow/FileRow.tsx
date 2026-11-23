import "./filerow.css";
import { safeHref } from "../../format";
export interface FileRowProps { name: string; size?: number; href?: string; kind?: string }
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"]; let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(1)} ${units[u]}`;
}
export function FileRow({ name, size, href, kind }: FileRowProps) {
  const ext = (kind ?? (name.includes(".") ? name.split(".").pop() : "") ?? "").slice(0, 4).toUpperCase() || "FILE";
  const link = href ? safeHref(href) : null;
  const label = <b>{name}</b>;
  return (
    <div className="fl-file">
      <span className="fl-file-ico" aria-hidden>{ext}</span>
      <span className="fl-file-main">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer">{label}</a> : label}
        {size !== undefined ? <small>{humanSize(size)}</small> : null}
      </span>
    </div>
  );
}
