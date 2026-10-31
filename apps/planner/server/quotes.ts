// Service quotes for a draft (docs/V3-FLOW-SPEC.md "Timeline" step 4): the agent fills a cart on each connected service
// and posts what checkout said; the app keeps one quote per service and picks the best — the household's learned
// service rule when there is one, else the cheapest grand total. Pure: server/draft.ts stores them.
import { parseJson } from "./quantity";

export interface QuoteLine { name: string; pack?: string | null; qty?: number | null; price?: number | null; matched_ingredient_id?: string | null; substituted?: boolean | string | null }
export interface QuoteInput { service: string; total: number; fees?: number | Record<string, number> | null; lines?: QuoteLine[] | null; screenshot_url?: string | null; delivery?: string | null }
export interface Quote extends QuoteInput { at: string; lines_key: string }

/** learned_prefs kind "service" (rule JSON): use `service` unless another quote is at least `unless_cheaper_by` ₹ cheaper. */
export interface ServiceRule { service: string; unless_cheaper_by?: number }
export interface BestQuote { service: string; total: number; reason: "learned" | "cheapest" }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sameService = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Why a posted quote can't be stored, or null. */
export function quoteProblem(b: unknown): string | null {
  const q = b as Partial<QuoteInput> | null;
  if (!q || typeof q !== "object") return "body must be a JSON object";
  if (typeof q.service !== "string" || !q.service.trim()) return "service is required";
  if (!isNum(q.total) || q.total < 0) return "total (the checkout grand total, ₹) is required";
  if (q.fees != null && !isNum(q.fees) && (typeof q.fees !== "object" || Object.values(q.fees).some((v) => !isNum(v)))) return "fees must be a number or {name: number}";
  if (q.lines != null && (!Array.isArray(q.lines) || q.lines.some((l) => !l || typeof l.name !== "string"))) return "lines must be a list of {name, pack, qty, price}";
  if (q.screenshot_url != null && typeof q.screenshot_url !== "string") return "screenshot_url must be a string";
  return null;
}

export const parseQuotes = (raw: string | null | undefined): Quote[] => {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? v.filter((q): q is Quote => !!q && typeof q.service === "string" && isNum(q.total)) : [];
};

/** The quotes after `q` replaces any earlier quote from the same service. */
export const upsertQuote = (quotes: Quote[], q: Quote): Quote[] => [...quotes.filter((x) => !sameService(x.service, q.service)), q];

/** The best quote: the learned service when quoted and not beaten by its own margin, else the cheapest grand total. */
export function bestQuote(quotes: Quote[], rule: ServiceRule | null): BestQuote | null {
  if (!quotes.length) return null;
  const cheapest = [...quotes].sort((a, b) => a.total - b.total)[0];
  const preferred = rule?.service ? quotes.find((q) => sameService(q.service, rule.service)) : undefined;
  if (preferred) {
    const margin = isNum(rule!.unless_cheaper_by) ? rule!.unless_cheaper_by : Infinity;
    if (preferred.total - cheapest.total < margin) return { service: preferred.service, total: preferred.total, reason: "learned" };
  }
  return { service: cheapest.service, total: cheapest.total, reason: "cheapest" };
}
