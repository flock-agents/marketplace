export interface NounLabels { one: string; many: string; title: string; nav: string }
/** "Classes" -> "class", "Parties" -> "party", "Clients" -> "client"; a word that does not end in a plain plural is left as it is. */
const SAME = new Set(["series", "news", "species"]);
export function singular(w: string): string {
  if (SAME.has(w) || /(ss|us|is)$/.test(w)) return w;
  if (/(movie|cookie|rookie|calorie)s$/.test(w)) return w.slice(0, -1);
  if (/uses$/.test(w)) return w.replace(/es$/, "");
  if (/[^aeiou]ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(sses|xes|zes|ches|shes)$/.test(w)) return w.replace(/es$/, "");
  return w.endsWith("s") ? w.slice(0, -1) : w;
}
/** A tab name as a noun: lower case, a leading "my", "our", "all" or "the" dropped ("My Clients" -> "clients"). */
const tabNoun = (v: string): string => v.trim().toLowerCase().replace(/^(my|our|all|the)\s+/, "");
/** What the people an invoice is billed to are called. An explicit noun (noun.one / noun.many, set apart from its default) wins; one still
 *  at its default follows the renamed nav label (the short word), then the page title. */
export function nounsFrom(l: NounLabels): { one: string; many: string } {
  const renamed = [l.nav, l.title].map(tabNoun).find((v) => v && v !== "customers");
  const manyExplicit = l.many !== "customers", oneExplicit = l.one !== "customer";
  const many = manyExplicit ? l.many : renamed ?? l.many;
  const one = oneExplicit ? l.one : manyExplicit ? singular(l.many) : renamed ? singular(renamed) : l.one;
  return { one, many };
}
