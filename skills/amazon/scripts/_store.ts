/**
 * Amazon.in — the cards the agent last sent, so read-variants can answer the whole set again with one
 * product swapped for its every-variant card (owner 2026-10-26: "retain the older options we showed").
 * A skill script is not told which chat it runs for, so the cards are kept per agent (the last 20
 * blocks, a day at most) and found by the product's ASIN, newest first.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface SavedCards { at: number; title?: string; items: any[] }

const KEEP = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fileFor(agentId: string, dir = process.env.SKILL_DATA_DIR || ""): string | null {
  if (!dir || !/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  return join(dir, "amazon", "cards", `${agentId}.json`);
}

function load(file: string): SavedCards[] {
  try { const v = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Keeps one block's cards. Never fails the run: a card not kept only means a later read-variants
 *  answers that product alone. */
export function saveCards(agentId: string, cards: { title?: string; items: any[] }, opts: { dir?: string; now?: number } = {}): void {
  try {
    const file = fileFor(agentId, opts.dir);
    if (!file || cards.items.length === 0) return;
    mkdirSync(join(file, ".."), { recursive: true });
    const now = opts.now ?? Date.now();
    const kept = [{ at: now, ...(cards.title ? { title: cards.title } : {}), items: cards.items }, ...(existsSync(file) ? load(file) : [])]
      .filter((c) => now - c.at < MAX_AGE_MS).slice(0, KEEP);
    writeFileSync(`${file}.tmp`, JSON.stringify(kept));
    renameSync(`${file}.tmp`, file);
  } catch { /* see above */ }
}

/** The newest kept block holding the product `asin` (as a card's id), or null. */
export function findCards(agentId: string, asin: string, opts: { dir?: string; now?: number } = {}): SavedCards | null {
  const file = fileFor(agentId, opts.dir);
  if (!file || !existsSync(file)) return null;
  const now = opts.now ?? Date.now();
  return load(file).find((c) => now - c.at < MAX_AGE_MS && Array.isArray(c.items) && c.items.some((it) => it?.id === asin)) ?? null;
}
