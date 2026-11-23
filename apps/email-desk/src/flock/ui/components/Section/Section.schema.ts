import { z } from "zod";
import { defineSchema, node } from "../../schema-def";
export const SectionSchema = defineSchema({
  name: "Section", group: "frame",
  description: "A titled block of content inside a page, with an optional actions slot.",
  chat: {
    kids: `components`,
    use: "a titled part of a MiniApp or Tab",
    avoid: "a record with a meta line (a Card); the frame of a whole answer (a MiniApp)",
    needs: "a short `title`; its content as children",
    example: {"type": "Section", "props": {"title": "Overdue", "emphasis": "subtle"}, "children": [{"type": "RowList", "props": {"rows": [{"id": "1", "name": "Water bill", "meta": "BWSSB, 9 days late", "value": 640, "kind": "money"}]}}]},
  },
  props: z.object({
    title: z.string().optional().describe("section heading"),
    actions: node("buttons shown at the right of the heading").optional(),
    emphasis: z.enum(["plain", "subtle"]).optional().describe("plain (default), or subtle for a soft panel"),
    children: node("the section content"),
  }),
  example: `<Section title="Overdue" emphasis="subtle">…</Section>`,
});
