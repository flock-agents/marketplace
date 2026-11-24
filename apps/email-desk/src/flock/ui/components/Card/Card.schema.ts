import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
export const CardSchema = defineSchema({
  name: "Card", group: "records",
  description: "A bordered container with a title, a meta line and an actions slot; clickable when onClick is set.",
  chat: {
    kids: `components`,
    use: "one titled record with a meta line",
    avoid: "a titled part of a frame (a Section); an option to pick (a Choice of cards); a highlighted figure (a BigCard)",
    needs: "a short `title` and `meta`; a body of a line or two (Markdown) as children",
    example: {"type": "Card", "props": {"title": "Car service", "meta": "Sat 15 Nov, Sai Motors"}, "children": [{"type": "Markdown", "props": {"text": "Ask about the AC noise; the last bill was ₹6,400."}}]},
  },
  props: z.object({
    title: node("heading line").optional(), meta: node("small grey line under the title").optional(),
    actions: node("buttons shown at the right of the header").optional(),
    onClick: fn("makes the whole card a button").optional(),
    children: node("the card body").optional(),
    emphasis: z.enum(["plain", "subtle"]).optional().describe("subtle uses a quieter background"),
  }),
  example: `<Card title="Venue" meta="Due Fri" actions={<Button size="sm" variant="soft">Edit</Button>}>Hall booked for 40.</Card>`,
});
