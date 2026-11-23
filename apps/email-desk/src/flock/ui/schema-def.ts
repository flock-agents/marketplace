// What a component declares apart from its React component: the chat's validator (chat/validate.ts) and the Flock
// server read these, so this module and every *.schema.ts imports neither React nor a .tsx file. define.ts adds the
// component and re-exports what is here.
import { z } from "zod";
export type Group = "frame" | "text" | "data" | "records" | "inputs" | "media" | "states" | "agent" | "values";
/** How an agent uses a component in a chat block (```flock-ui): the agent's flock-blocks skill is generated
 *  from these (packages/ui/scripts/gen-chat-blocks.ts), so the guidance lives with the component and cannot drift. */
export interface ChatGuide {
  /** What it is for in chat, one short line: the flock-blocks skill prints it as `Use: …` in the component's entry. */
  use: string;
  /** When not to use it, and what to use instead. */
  avoid: string;
  /** What it needs to look right: formats, sizes, fields that are required in practice. */
  needs: string;
  /** A full chat block (JSON) in realistic content: the flock-blocks skill shows it in the component's entry, so it must
   *  pass the check with nothing repaired, dropped or warned (server tests/chat-blocks-skill.test.ts). */
  example?: unknown;
  /** A container's child blocks (the shape line itself is generated from the props: schema-info signatureLine), written in its `children` beside `props` (a MiniApp's Tabs, a Questions' Choices). */
  kids?: string;
}
/** A component's declaration without its React component (`<Name>.schema.ts`). */
export interface SchemaDef<S extends z.ZodObject<any>> {
  name: string; description: string; group: Group; props: S;
  example?: string;
  /** Set on every chat component (packages/ui/src/chat/allowlist.ts). */
  chat?: ChatGuide;
}
/** A chat component's schema, as chat/chat-schemas.ts lists them. */
export type ChatSchemaDef = SchemaDef<any>;
export function defineSchema<S extends z.ZodObject<any>>(def: SchemaDef<S>): SchemaDef<S> {
  if (!/^[A-Z][A-Za-z]+$/.test(def.name)) throw new Error(`component name must be PascalCase: ${def.name}`);
  if (!def.description || def.description.length > 140) throw new Error(`${def.name}: description must be one line (≤140 chars)`);
  return def;
}
/** A callback prop. Zod cannot describe functions as data, so the type lives in the description. */
export function fn<T extends (...a: any[]) => any>(description: string): z.ZodType<T> {
  return z.custom<T>((v) => typeof v === "function").describe(`function — ${description}`);
}
/** A node prop (a React node where the component draws it; define.ts's node() types it so). */
export function node(description: string): z.ZodType<unknown> {
  return z.custom<unknown>(() => true).describe(`React node — ${description}`);
}
