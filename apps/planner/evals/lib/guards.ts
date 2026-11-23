// The eval guards' helpers (spec §8), pure: a small TypeScript scanner (comments, strings, templates, regex literals), the
// household-name check and the word-list check. server/evalGuards.test.ts runs them over the planner's code.

// ── A small TypeScript scanner: comments, strings, template text, regex literals ──

export type Piece = { kind: "string" | "template" | "regex" | "comment"; text: string; line: number };
/** Split TypeScript source into its comments, string literals, template text and regex literals (code tokens dropped).
 *  A "/" opens a regex where an operand is expected (after an operator, a bracket, a comma, a keyword or line start). */
export function scan(src: string): Piece[] {
  const out: Piece[] = [];
  let i = 0, line = 1, prev = "";
  const tmpl: number[] = [];
  const push = (kind: Piece["kind"], text: string, l: number) => out.push({ kind, text, line: l });
  const kw = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; push("comment", src.slice(i + 2, end), line); i = end; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e; const t = src.slice(i + 2, end); push("comment", t, line); line += t.split("\n").length - 1; i = end + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") { s += src[j] + src[j + 1]; j += 2; } else s += src[j++]; }
      push("string", s, line); i = j + 1; prev = "x"; continue;
    }
    if (c === "`" || (c === "}" && tmpl.length && tmpl[tmpl.length - 1] === 0)) {
      if (c === "}") tmpl.pop();
      let j = i + 1, s = "";
      const l0 = line;
      while (j < src.length && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) { if (src[j] === "\\") { s += src[j] + src[j + 1]; j += 2; continue; } if (src[j] === "\n") line++; s += src[j++]; }
      push("template", s, l0);
      if (src[j] === "$") { tmpl.push(0); i = j + 2; prev = "("; } else { i = j + 1; prev = "x"; }
      continue;
    }
    if (c === "{") { if (tmpl.length) tmpl[tmpl.length - 1]++; i++; prev = c; continue; }
    if (c === "}") { if (tmpl.length) tmpl[tmpl.length - 1]--; i++; prev = c; continue; }
    if (c === "/") {
      const before = src.slice(Math.max(0, i - 12), i).trimEnd();
      const operand = !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || kw.test(before);
      if (operand) {
        let j = i + 1, inClass = false, s = "";
        while (j < src.length && src[j] !== "\n") {
          if (src[j] === "\\") { s += src[j] + src[j + 1]; j += 2; continue; }
          if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false; else if (src[j] === "/" && !inClass) break;
          s += src[j++];
        }
        if (src[j] === "/") { push("regex", s, line); j++; while (/[a-z]/i.test(src[j] ?? "")) j++; i = j; prev = "x"; continue; }
      }
      i++; prev = "/"; continue;
    }
    if (/[\w$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; prev = src.slice(i, j); i = j; continue; }
    prev = c; i++;
  }
  return out;
}

export function nameHits(texts: { file: string; line: number; text: string }[], names: string[]): string[] {
  const hits: string[] = [];
  for (const n of names) {
    const re = new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
    for (const t of texts) if (re.test(t.text)) hits.push(`${t.file}:${t.line}: "${n}" in ${JSON.stringify(t.text.trim().slice(0, 100))}`);
  }
  return hits;
}

// ── Word lists ──

export const WORD_LIST = {
  weekday: /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b|\bweek ?(?:ends?|days?)\b/i,
  kinship: /\b(?:amma|appa|papa|pappa|mummy|mumma|mama|mami|maa|nani|nana|nanna|dadi|dada|dadu|baba|ba|bapuji|papaji|thatha|paati|ajji|aai|aaji|mother|father|mom|dad|grand(?:ma|pa|mother|father|son|daughter)|son|daughter|wife|husband|bhabhi|chacha|chachi|mausi|bua|didi|bhaiya|uncle|aunty?|aunt)\b/i,
  less_more: /\b(?:less|more)\b/i,
};
export type WordHit = { file: string; line: number; kind: string; text: string };
/** The regexes of a source (literals, and RegExp("...") / RegExp(`...`) string arguments) that hold a listed word. */
export function wordListHits(src: string, file = "<src>"): WordHit[] {
  const hits: WordHit[] = [];
  const regexes = scan(src).filter((p) => p.kind === "regex");
  // RegExp("...") and RegExp(`...`): the string right after "RegExp(".
  for (const m of src.matchAll(/\bRegExp\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) regexes.push({ kind: "regex", text: m[2], line: src.slice(0, m.index).split("\n").length });
  for (const r of regexes) for (const [kind, re] of Object.entries(WORD_LIST)) {
    // Read the regex as words: alternations and groups split, escapes like \b \s dropped.
    const words = r.text.replace(/\\[bBsSdDwW]/g, " ").replace(/[()|?:*+^$[\]{}\\]/g, " ");
    if (re.test(words)) hits.push({ file, line: r.line, kind, text: r.text });
  }
  return hits;
}
export const show = (h: WordHit) => `${h.file}:${h.line}: ${h.kind} in /${h.text.slice(0, 100)}/`;

