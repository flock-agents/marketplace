// How the app's own writes tell live pages. kit.emitChange unmarks a sample row on any update, so the app's bookkeeping
// (a meal's recipe link, its recipe set, an inferred outcome, a recompute) would turn a template's samples into the
// owner's rows. index.ts sets an emitter on the kit's event bus at start; routines use it too. Unset (unit tests), it
// falls back to the routine's kit.emitChange.
export type AppEmit = (table: string, id: string, op: "insert" | "update" | "delete") => void;

let current: AppEmit | null = null;

export function setAppEmit(emit: AppEmit): void { current = emit; }

export function appEmit(kit: { emitChange(table: string, id: string, op: "insert" | "update" | "delete", by: string): void }): AppEmit {
  return current ?? ((table, id, op) => kit.emitChange(table, id, op, "app"));
}
