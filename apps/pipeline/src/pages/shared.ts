import { label } from "../flock/ui";
import { STAGES as STAGE_LIST } from "../../server/db/constants";

export interface Deal {
  id: string; title: string; stage: string; owner: string | null; value: number | null; next_step: string | null; due: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
}
/** What the chat is pointed at: the deal the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

/** The stages come from server/db/constants.ts; change the tones here when they change. */
export const STAGES: string[] = [...STAGE_LIST];
export const STAGE_TONES = { Lead: "muted", Talking: "info", Proposal: "accent", Won: "success", Lost: "danger" } as const;

/** What one row is called (label noun.one / noun.many, default deal / deals): a pipeline of leads or orders reads in its own words. */
export const one = () => label("noun.one", "deal");
export const many = () => label("noun.many", "deals");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The words shown for a stage (label stage.<Value>); the stored value never changes, so agents and rows keep using STAGES. A call per
 *  stage, each a literal key, because labels are checked against flock.app.json. Read at render time (labels load with the app info). */
export function stageLabel(s: string): string {
  switch (s) {
    case "Lead": return label("stage.Lead", "Lead");
    case "Talking": return label("stage.Talking", "Talking");
    case "Proposal": return label("stage.Proposal", "Proposal");
    case "Won": return label("stage.Won", "Won");
    case "Lost": return label("stage.Lost", "Lost");
    default: return s;
  }
}
export const stageLabels = (): Record<string, string> => Object.fromEntries(STAGES.map((s) => [s, stageLabel(s)]));

/** Any row with a value? A pipeline that does not track money shows no value strip, card value or column. */
export const anyValue = (rows: Pick<Deal, "value">[]): boolean => rows.some((r) => r.value !== null && r.value !== undefined);

/** The form fields for one deal. */
export const fields = () => [
  { type: "text", name: "title", label: cap(one()), required: true },
  { type: "select", name: "stage", label: "Stage", options: STAGES, optionLabels: stageLabels() },
  { type: "person", name: "owner", label: "Owner" },
  { type: "money", name: "value", label: "Value" },
  { type: "text", name: "next_step", label: "Next step" },
  { type: "date", name: "due", label: "Due" },
] as const;

/** Deals nulls-last by due date. */
export const dueLast = (rows: Deal[]): Deal[] => [...rows.filter((r) => r.due), ...rows.filter((r) => !r.due)];

/** Total value per stage, in stage order. */
export const valueByStage = (rows: Deal[]) => STAGES.map((s) => ({ label: stageLabel(s).toLowerCase(), value: rows.filter((r) => r.stage === s).reduce((n, r) => n + (r.value ?? 0), 0), kind: "compact" as const }));
