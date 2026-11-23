const INR = new Intl.NumberFormat("en-IN");
const INR_EXACT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MINUS = "−";
function trimZeros(s: string): string { return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"); }

export function formatNumber(n: number): string { return INR.format(n); }

export function formatINR(n: number, opts: { compact?: boolean; signed?: boolean; abs?: boolean; exact?: boolean } = {}): string {
  const a = Math.abs(n);
  let s: string;
  if (opts.compact) {
    s = a >= 1e7 ? `${trimZeros((a / 1e7).toFixed(2))} Cr`
      : a >= 1e5 ? `${trimZeros((a / 1e5).toFixed(2))}L`
      : a >= 1e3 ? `${trimZeros((a / 1e3).toFixed(1))}k`
      : String(a);
  } else s = opts.exact ? INR_EXACT.format(a) : INR.format(a);
  const sign = opts.abs ? "" : n < 0 ? MINUS : opts.signed && n > 0 ? "+" : "";
  return `${sign}₹${s}`;
}

export function formatPercentChange(n: number): string {
  return `${n >= 0 ? "+" : MINUS}${Math.abs(n).toFixed(1)}%`;
}

const DAY = 86_400_000;
function todayIso(): string { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
export function relativeDate(iso: string, today: string = todayIso()): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = Date.parse(iso.slice(0, 10) + "T00:00:00Z"), t = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(d)) return iso;
  const diff = Math.round((d - t) / DAY);
  if (diff === 0) return "Today"; if (diff === -1) return "Yesterday"; if (diff === 1) return "Tomorrow";
  const date = new Date(d);
  const sameYear = date.getUTCFullYear() === new Date(t).getUTCFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(sameYear ? {} : { year: "numeric" }) });
}

export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

/** For <img src>: http(s) or a root-relative path. No data:, protocol-relative, file: or javascript:. */
export function safeSrc(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return /^\/(?![\/\\])/.test(u) ? u : null;
}

const FIGURE = /^([-+−]?)\s*(?:₹|rs\.?|inr)?\s*([-+−]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores|k|%)?$/i;
const SCALE: Record<string, number> = { l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, k: 1e3, "%": 1 };
/** A figure an agent wrote as text, as a number: "₹1,42,000" 142000, "1.2L" 120000, "3.5 Cr" 35000000, "7.25%" 7.25,
 *  "12k" 12000, "1,200" 1200. A number is itself; anything else (a range, a date, words) is null. */
export function figure(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = FIGURE.exec(v.trim());
  if (!m) return null;
  const digits = m[3].replace(/,/g, "");
  const n = Number((Number(digits) * (m[4] ? SCALE[m[4].toLowerCase()] : 1)).toPrecision(12));
  if (!isFinite(n)) return null;
  const negative = (m[1] && m[1] !== "+") || (m[2] && m[2] !== "+");
  return negative ? -n : n;
}

/** Any value as words, never "[object Object]" and never JSON: a list reads "a, b"; an object its label/title/name,
 *  else "key: value, …". Agent data arrives as anything, so this never throws. */
export function readable(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return depth > 3 ? "" : v.map((x) => readable(x, depth + 1)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    if (depth > 3) return "";
    const o = v as Record<string, unknown>;
    const named = o.label ?? o.title ?? o.name;
    if (typeof named === "string" || typeof named === "number") return String(named);
    return Object.entries(o).map(([k, x]) => { const t = readable(x, depth + 1); return t ? `${k}: ${t}` : ""; }).filter(Boolean).join(", ");
  }
  return String(v);
}
