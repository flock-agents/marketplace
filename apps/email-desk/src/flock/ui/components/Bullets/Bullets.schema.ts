import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const BulletsSchema = defineSchema({
  name: "Bullets", group: "text",
  description: "A plain bulleted list of short strings.",
  chat: {
    use: "up to 8 short lines inside a block",
    avoid: "items to tick off (a Checklist); timed day items (a Schedule); \"Label: value\" pairs (a Detail)",
    needs: "`items` as plain strings, a few words each",
    example: {"type": "Section", "props": {"title": "The AC service covers"}, "children": [{"type": "Bullets", "props": {"items": ["Filter and coil cleaning", "Gas pressure check", "One free repair visit"]}}]},
  },
  props: z.object({ items: z.array(z.string()).describe("one short line per bullet") }),
  example: `<Bullets items={["Fast", "Private", "Yours"]} />`,
});
