import type { ComponentType, ReactNode } from "react";
import type { z } from "zod";
import { defineSchema, node as schemaNode, type SchemaDef } from "./schema-def";
export { fn, defineSchema } from "./schema-def";
export type { Group, ChatGuide, SchemaDef, ChatSchemaDef } from "./schema-def";
export interface ComponentDef<S extends z.ZodObject<any>> extends SchemaDef<S> {
  component: ComponentType<any>;
}
export function defineComponent<S extends z.ZodObject<any>>(def: ComponentDef<S>): ComponentDef<S> {
  defineSchema(def);
  return def;
}
export function node(description: string): z.ZodType<ReactNode> {
  return schemaNode(description) as z.ZodType<ReactNode>;
}
