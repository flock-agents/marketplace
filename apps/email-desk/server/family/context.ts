// WHO THE FAMILY IS: the pure shaping half of #370's family-context.ts.
//
// Flock's version read Flock's people, Memory's family entities and the owner's identity in-process. Those reads are
// platform state no SDK call gives (ruling R9), so here the context is an INPUT: the caller hands in what it could read
// (Flock's optional `family.context()` / `family.household()` through the seam), and these functions only shape it.
//
// FAILS OPEN, every part, as the source did: a source that can't be read adds nothing. An empty names list makes the
// personal filter's bulk rule keep the mail, and a Family Calendar item with no `who` is the whole family's.
import type { FamilyContext } from "../lib/personal-mail-rules";
import type { RoutineCtx } from "../platform-ext";

/** First names and surnames as separate words: "Agastya Shankar" names Agastya in "Dear Agastya". */
export function nameWords(full: string | null | undefined): string[] {
  return (full ?? "").split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}'-]/gu, "")).filter((w) => w.length > 1);
}

export interface FamilySources {
  /** The mailbox's own addresses: always family addresses. */
  mailboxAddresses: readonly string[];
  /** Flock's people (the owner and every member): full names and email addresses. */
  people?: ReadonlyArray<{ name?: string | null; email?: string | null }>;
  /** People Memory knows as family (person entities, subtype "family"), by full name. */
  familyNames?: readonly string[];
  /** The owner's name and the name they are called. */
  ownerNames?: ReadonlyArray<string | null | undefined>;
}

/** The personal-mail rules' family (source familyContext), from what the caller could read. */
export function familyContextFrom(s: FamilySources): FamilyContext {
  const names = new Set<string>();
  const addresses = new Set<string>(s.mailboxAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  for (const p of s.people ?? []) {
    for (const w of nameWords(p.name)) names.add(w);
    if (p.email?.trim()) addresses.add(p.email.trim().toLowerCase());
  }
  for (const n of s.familyNames ?? []) for (const w of nameWords(n)) names.add(w);
  for (const n of s.ownerNames ?? []) for (const w of nameWords(n)) names.add(w);
  return { names: [...names], addresses: [...addresses], schoolDomains: [] };
}

/**
 * WHO A FAMILY CALENDAR ITEM MAY BE FOR (family/push.ts `who`): the household, stricter than the filter's names. The Family
 * Calendar adds any `who` it does not know as a family member, so a name read only in mail never counts (live 2026-11-22:
 * "Anya, Priya's daughter" from a party invite became a member). First names only, each once.
 */
export function householdNamesFrom(fullNames: ReadonlyArray<string | null | undefined>): string[] {
  const names = new Set<string>();
  for (const full of fullNames) {
    const first = nameWords(full)[0];
    if (first) names.add(first);
  }
  return [...names];
}

/** The household's first names from Flock (`family.household()`), else none. Never throws. */
export async function householdNames(ctx: RoutineCtx): Promise<string[]> {
  try {
    const r = await ctx.platform.family?.household?.();
    return r && r.ok && Array.isArray(r.data?.names) ? householdNamesFrom(r.data.names.filter((n): n is string => typeof n === "string")) : [];
  } catch {
    return [];
  }
}

/** The person's first name for the import label ("Shiva's email"): Flock's `identity.names()`, else null. Never throws. */
export async function personFirstName(ctx: RoutineCtx): Promise<string | null> {
  try {
    const r = await ctx.platform.identity?.names?.();
    const first = r && r.ok && Array.isArray(r.data?.names) ? nameWords(r.data.names.find((n) => typeof n === "string" && n.trim()))[0] : undefined;
    return first ?? null;
  } catch {
    return null;
  }
}
