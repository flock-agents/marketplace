import { defineComponent } from "../../define";
import { Markdown } from "./Markdown";
import { MarkdownSchema } from "./Markdown.schema";
export const MarkdownDef = defineComponent({ ...MarkdownSchema, component: Markdown });
