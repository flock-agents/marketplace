import { z } from "zod";
import { defineSchema, node } from "../../schema-def";
import { Tone, IconName } from "../../tone";
export const CalloutSchema = defineSchema({
  name: "Callout", group: "text",
  description: "A short highlighted note with a tone and an optional icon.",
  chat: {
    use: "one warning or tip, a sentence or two",
    avoid: "a caveat written as prose after the block",
    needs: "`tone` (warning, info, success, danger); the text as `children`, a sentence or two; leave out `icon`",
    example: {"type": "Callout", "props": {"tone": "warning", "title": "Check the fine print", "children": "The Jio plan locks you in for 12 months; leaving early costs ₹1,500."}},
  },
  props: z.object({
    tone: Tone.optional().describe("neutral (default), accent, success, warning, danger, info, muted"),
    icon: IconName.optional().describe("lucide icon name shown before the title"),
    title: z.string().optional().describe("bold lead that says what the note is about"),
    children: node("the note text"),
  }),
  example: `<Callout tone="warning" icon="triangle-alert" title="Heads up">Two invoices are overdue.</Callout>`,
});
