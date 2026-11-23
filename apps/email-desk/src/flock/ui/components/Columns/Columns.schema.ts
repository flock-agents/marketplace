import { z } from "zod";
import { defineSchema, node } from "../../schema-def";
export const ColumnsSchema = defineSchema({
  name: "Columns", group: "frame",
  description: "Lays its children side by side in columns; they stack under 720px.",
  chat: {
    kids: `2 or 3 blocks`,
    use: "2 or 3 short things side by side",
    avoid: "options to compare (a Choice of cards); anything that only makes sense side by side",
    needs: "2 or 3 children (Sections), a few lines each",
    example: {"type": "Columns", "props": {"ratio": "1:1"}, "children": [{"type": "Section", "props": {"title": "Done"}, "children": [{"type": "Bullets", "props": {"items": ["Hall booked", "Caterer advance paid"]}}]}, {"type": "Section", "props": {"title": "Next"}, "children": [{"type": "Bullets", "props": {"items": ["Order the cake", "Send the invites"]}}]}]},
  },
  props: z.object({
    ratio: z.enum(["1:1", "2:1", "1:2", "1:1:1"]).optional().describe("column widths, 1:1 (default), 2:1, 1:2, 1:1:1"),
    children: node("one child per column"),
  }),
  example: `<Columns ratio="2:1"><Section title="Board">…</Section><Section title="Notes">…</Section></Columns>`,
});
