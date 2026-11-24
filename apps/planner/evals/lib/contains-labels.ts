// The labelled dish set for Eval 1's contains accuracy (spec §8): 40 dishes as an Indian home usually makes them, each with
// the base tags it has (`yes`); every other base tag is a "no", except `either` (the home version varies: not scored).
// Written by hand from what the dishes are, not from any model's answer.
import { BASE_TAGS } from "./vocab";

export type Tag = (typeof BASE_TAGS)[number];
export type Label = { dish: string; yes: Tag[]; either?: Tag[] };

export const CONTAINS_LABELS: Label[] = [
  { dish: "Poha", yes: ["white_rice", "onion_garlic"], either: ["peanut", "nuts", "root_veg"] },
  { dish: "Upma", yes: ["onion_garlic"], either: ["nuts", "root_veg", "dairy"] },
  { dish: "Idli", yes: ["white_rice"] },
  { dish: "Masala dosa", yes: ["white_rice", "root_veg", "onion_garlic"], either: ["dairy"] },
  { dish: "Ragi dosa", yes: ["millet"], either: ["onion_garlic", "white_rice"] },
  { dish: "Aloo paratha", yes: ["root_veg"], either: ["onion_garlic", "dairy"] },
  { dish: "Bread omelette", yes: ["egg", "onion_garlic"], either: ["dairy"] },
  { dish: "Egg bhurji", yes: ["egg", "onion_garlic"], either: ["dairy", "root_veg"] },
  { dish: "Besan chilla", yes: ["onion_garlic"], either: ["dairy"] },
  { dish: "Ven pongal", yes: ["white_rice", "dairy"], either: ["nuts"] },
  { dish: "Sabudana khichdi", yes: ["peanut", "nuts", "root_veg"], either: ["dairy"] },
  { dish: "Rajma chawal", yes: ["white_rice", "onion_garlic"], either: ["dairy"] },
  { dish: "Dal tadka", yes: ["onion_garlic"], either: ["dairy"] },
  { dish: "Jeera rice", yes: ["white_rice"], either: ["dairy"] },
  { dish: "Curd rice", yes: ["white_rice", "dairy"], either: ["nuts"] },
  { dish: "Lemon rice", yes: ["white_rice", "peanut", "nuts"] },
  { dish: "Bisi bele bath", yes: ["white_rice"], either: ["onion_garlic", "nuts", "dairy", "root_veg"] },
  { dish: "Chicken curry", yes: ["meat", "onion_garlic"], either: ["dairy"] },
  { dish: "Mutton biryani", yes: ["meat", "white_rice", "onion_garlic", "dairy"], either: ["nuts", "root_veg"] },
  { dish: "Fish fry", yes: ["fish"], either: ["onion_garlic"] },
  { dish: "Maacher jhol", yes: ["fish"], either: ["onion_garlic", "root_veg"] },
  { dish: "Prawn curry", yes: ["fish", "onion_garlic"], either: ["dairy"] },
  { dish: "Egg curry", yes: ["egg", "onion_garlic"], either: ["dairy"] },
  { dish: "Paneer butter masala", yes: ["dairy", "onion_garlic"], either: ["nuts", "sugar"] },
  { dish: "Palak paneer", yes: ["dairy", "onion_garlic"] },
  { dish: "Aloo gobi", yes: ["root_veg"], either: ["onion_garlic"] },
  { dish: "Bhindi fry", yes: [], either: ["onion_garlic"] },
  { dish: "Mushroom masala", yes: ["mushroom", "onion_garlic"], either: ["dairy"] },
  { dish: "Raita", yes: ["dairy"], either: ["onion_garlic", "root_veg"] },
  { dish: "Kadhi chawal", yes: ["dairy", "white_rice"], either: ["onion_garlic"] },
  { dish: "Chapati", yes: [], either: ["dairy"] },
  { dish: "Jowar roti", yes: ["millet"] },
  { dish: "Bajra khichdi", yes: ["millet"], either: ["onion_garlic", "dairy", "white_rice"] },
  { dish: "Gajar halwa", yes: ["sugar", "dairy", "root_veg"], either: ["nuts"] },
  { dish: "Rava sheera", yes: ["sugar", "dairy"], either: ["nuts"] },
  { dish: "Peanut chikki", yes: ["peanut", "nuts", "sugar"] },
  { dish: "Kaju katli", yes: ["nuts", "sugar"], either: ["dairy"] },
  { dish: "Sambar", yes: [], either: ["onion_garlic", "root_veg"] },
  { dish: "Pav bhaji", yes: ["root_veg", "onion_garlic", "dairy"] },
  { dish: "Sprouts salad", yes: ["onion_garlic"], either: ["peanut", "nuts", "root_veg"] },
];

export type ContainsScore = { rates: Record<string, [number, number]>; perTag: Record<string, { tp: number; fp: number; fn: number; tn: number; unread: number }>; notes: string[] };

/** The planner's contains read (dish → tag → true/false, an absent tag = not read) against the labels. Fields: `accuracy`
 *  (each scored dish-tag), `recall` (each true tag: a missed "yes" is what lets a hard rule through), `unread` (scored tags
 *  the read left out: fail-closed, so not wrong, but each one blocks a dish). */
export function scoreContains(got: Record<string, Record<string, boolean> | undefined>, labels: Label[] = CONTAINS_LABELS): ContainsScore {
  const rates: ContainsScore["rates"] = {}, perTag: ContainsScore["perTag"] = {}, notes: string[] = [];
  const add = (f: string, ok: boolean) => { const r = (rates[f] ??= [0, 0]); r[1]++; if (ok) r[0]++; };
  const find = (dish: string) => Object.entries(got).find(([k]) => k.trim().toLowerCase() === dish.toLowerCase())?.[1];
  for (const l of labels) {
    const read = find(l.dish);
    for (const tag of BASE_TAGS) {
      if (l.either?.includes(tag)) continue;
      const want = l.yes.includes(tag), have = read?.[tag];
      const p = (perTag[tag] ??= { tp: 0, fp: 0, fn: 0, tn: 0, unread: 0 });
      if (have === undefined) { p.unread++; add("read", false); if (want) notes.push(`${l.dish}: ${tag} not read`); continue; }
      add("read", true);
      add("accuracy", have === want);
      if (want) { add("recall", have); have ? p.tp++ : p.fn++; if (!have) notes.push(`${l.dish}: ${tag} missed`); }
      else { have ? p.fp++ : p.tn++; if (have) notes.push(`${l.dish}: ${tag} said, not in it`); }
    }
  }
  return { rates, perTag, notes };
}
