// The model plumbing every offline eval shares: Flock's app-model contract over OpenRouter (schema in the system prompt, one
// retry on an answer that does not fit it), plus a plain chat call for the persona and the judge. Moved here from
// scripts/setup-eval.ts, which imports it. The key is read from ~/Developer/flock/flock-web-services/.env and never printed.
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ModelRequest, ModelResult } from "../../server/model";

let key: string | null = null;
/** The OpenRouter key, read once. */
function KEY(): string {
  if (key) return key;
  const env = readFileSync(join(homedir(), "Developer/flock/flock-web-services/.env"), "utf8");
  const m = /^OPENROUTER_API_KEY=(.*)$/m.exec(env);
  if (!m) throw new Error("no OPENROUTER_API_KEY in flock-web-services/.env");
  return (key = m[1].trim().replace(/^["']|["']$/g, ""));
}

/** The live gateway's flock-balanced and flock-fast upstream (sim fws.log, 23 Nov). */
export const DEFAULT_UPSTREAM = "deepseek/deepseek-v4-flash";

/** flock-app/server/src/app-model.ts jsonIn. */
export function jsonIn(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?[ \t]*\n?([\s\S]*?)```/i.exec(t);
  for (const x of [t, ...(fence ? [fence[1].trim()] : [])]) {
    try { return JSON.parse(x); } catch { /* look inside */ }
  }
  for (const body of fence ? [fence[1], t] : [t]) {
    for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
      const b = body.lastIndexOf(close);
      for (let a = body.indexOf(open), n = 0; a >= 0 && a < b && n < 20; a = body.indexOf(open, a + 1), n++) {
        try { return JSON.parse(body.slice(a, b + 1)); } catch { /* the next opening */ }
      }
    }
  }
  throw new Error(`no JSON in the output (len=${text.length} end=${JSON.stringify(text.slice(-80))})`);
}
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
/** flock-app/server/src/app-model.ts schemaProblems, the subset the planner's schemas use. */
export function schemaProblems(s: any, v: unknown, path = "$", out: string[] = []): string[] {
  if (out.length >= 8 || !isObj(s)) return out;
  const at = (m: string) => out.push(`${path}: ${m}`);
  if (Array.isArray(s.anyOf) && !s.anyOf.some((x: any) => schemaProblems(x, v, path).length === 0)) at("matches none of the allowed shapes");
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t: string) => t === typeOf(v) || (t === "number" && typeOf(v) === "integer"))) { at(`must be ${types.join(" or ")}, got ${typeOf(v)}`); return out; }
  }
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(v))) at(`must be one of ${JSON.stringify(s.enum)}`);
  if (Array.isArray(v) && isObj(s.items)) v.forEach((x, n) => schemaProblems(s.items, x, `${path}[${n}]`, out));
  if (isObj(v)) {
    for (const k of s.required ?? []) if (!(k in v)) at(`"${k}" is required`);
    for (const [k, x] of Object.entries(v)) if (isObj(s.properties) && k in s.properties) schemaProblems(s.properties[k], x, `${path}.${k}`, out);
  }
  return out;
}

export type Usage = { out: number; think: number; cost: number };
/** Every call's spend, for the run's summary. */
export const spend = { calls: 0, in: 0, out: 0, cost: 0 };

/** One chat completion. `noThink`: reasoning { enabled: false } (a gateway route set to reasoning "off"); otherwise the
 *  model thinks as it likes. Tried 4 times on a transport error or an empty answer. */
export async function chat(o: { model: string; system: string; user: string; maxTokens: number; temperature: number; noThink?: boolean; reasoning?: object; usage?: Usage }): Promise<string> {
  let last = "";
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { authorization: `Bearer ${KEY()}`, "content-type": "application/json" },
        body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens, temperature: o.temperature, messages: [{ role: "system", content: o.system }, { role: "user", content: o.user }],
          usage: { include: true }, ...(o.reasoning ? { reasoning: o.reasoning } : o.noThink ? { reasoning: { enabled: false } } : {}) }),
        signal: AbortSignal.timeout(390_000),
      });
      const j: any = await r.json();
      const content = j?.choices?.[0]?.message?.content;
      spend.calls++; spend.in += j?.usage?.prompt_tokens ?? 0; spend.out += j?.usage?.completion_tokens ?? 0; spend.cost += j?.usage?.cost ?? 0;
      if (o.usage) { o.usage.out += j?.usage?.completion_tokens ?? 0; o.usage.think += j?.usage?.completion_tokens_details?.reasoning_tokens ?? 0; o.usage.cost += j?.usage?.cost ?? 0; }
      if (r.ok && typeof content === "string" && content.trim()) return content;
      last = JSON.stringify(j?.error ?? j).slice(0, 300);
    } catch (e) { last = String(e); }
    await Bun.sleep(2000 * (i + 1));
  }
  throw new Error(last);
}

export type CallRow = { purpose: string; tier: string; ms: number; ok: boolean; attempts: number; out: number; think: number; cost: number };

/** The app's ModelCall as Flock gives it, over OpenRouter: `upstream` per tier, temperature 0.4, the schema in the system
 *  prompt, one retry on an answer that is not JSON or does not fit. Every call is logged to `sink`. */
export function appModel(o: { upstream: { balanced: string; fast: string }; noThink?: boolean; prodTiers?: boolean; retier?: (req: ModelRequest) => ModelRequest; sink?: { push: (row: CallRow) => unknown }; onFail?: (req: ModelRequest, r: Extract<ModelResult, { ok: false }>) => void }) {
  return async (req0: ModelRequest): Promise<ModelResult> => {
    const req = o.retier ? o.retier(req0) : req0;
    const t0 = Date.now(), upstream = o.upstream[req.tier];
    // As Flock's own routes run them: balanced thinks a little (reasoning low), fast does not think.
    const reasoning = o.prodTiers ? (req.tier === "fast" ? { enabled: false } : { effort: "low" }) : undefined;
    const system = req.schema ? `${req.system}\n\nOutput ONLY one JSON value matching this JSON Schema: no prose, no code fence.\n${JSON.stringify(req.schema)}` : req.system;
    let problem = "", attempts = 0;
    const usage: Usage = { out: 0, think: 0, cost: 0 };
    const done = (r: ModelResult) => {
      o.sink?.push({ purpose: req.purpose ?? "", tier: req.tier, ms: Date.now() - t0, ok: r.ok, attempts, ...usage });
      if (!r.ok) o.onFail?.(req, r);
      return r;
    };
    for (let attempt = 0; attempt < (req.schema ? 2 : 1); attempt++) {
      attempts++;
      let text: string;
      try {
        text = await chat({ model: upstream, system, user: attempt === 0 ? req.user : `${req.user}\n\nYour last output could not be used (${problem}). Output only the JSON.`,
          maxTokens: Math.min(req.maxTokens ?? 4000, 16000), temperature: 0.4, noThink: o.noThink, reasoning, usage });
      } catch (e) { return done({ ok: false, code: "unavailable", message: String(e) }); }
      if (!req.schema) return done({ ok: true, text, model: upstream });
      let json: unknown;
      try { json = jsonIn(text); } catch (e) { problem = String(e); continue; }
      const ps = schemaProblems(req.schema, json);
      if (!ps.length) return done({ ok: true, json, model: upstream });
      problem = `it does not match the schema: ${ps.join("; ")}`;
    }
    return done({ ok: false, code: "invalid_output", message: problem });
  };
}

/** A JSON answer from a plain chat call (persona, judge): parsed leniently, asked again once when unreadable. */
export async function chatJson(o: Parameters<typeof chat>[0]): Promise<any> {
  let text = await chat(o);
  try { return jsonIn(text); } catch { /* once more */ }
  text = await chat({ ...o, user: `${o.user}\n\nAnswer with the JSON object only.` });
  return jsonIn(text);
}

/** Run `fn` over `xs`, at most `n` at a time, results in order. */
export async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) { const i = next++; out[i] = await fn(xs[i], i); }
  }));
  return out;
}

export const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
export const flag = (n: string): boolean => process.argv.includes(`--${n}`);
