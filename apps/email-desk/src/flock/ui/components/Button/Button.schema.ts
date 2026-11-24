import { z } from "zod";
import { defineSchema, node, fn } from "../../schema-def";
import { IconName } from "../../tone";
export const ButtonSchema = defineSchema({
  name: "Button", group: "inputs",
  description: "An action button: ink (primary), app (accent), soft, ghost, danger; optional loading state and split menu.",
  chat: {
    use: "one action, its label sent back",
    avoid: "several actions (a Choice); a link",
    needs: "a short label as `children`; one per block; an `id`",
    example: {"type": "Card", "props": {"title": "Airport cab", "meta": "Sat 5:30 AM, Uber XL, about ₹1,450"}, "children": [{"type": "Button", "id": "book-cab", "props": {"variant": "ink", "children": "Book the cab"}}]},
  },
  props: z.object({
    variant: z.enum(["ink", "app", "soft", "ghost", "danger"]).optional().describe("ink (default) primary, app uses the app accent"),
    size: z.enum(["sm", "md"]).optional().describe("md (default) or sm for tight spots"),
    icon: IconName.optional().describe("lucide icon name shown before the label"),
    loading: z.boolean().optional().describe("shows a spinner and disables the button; the label stays so width holds"),
    disabled: z.boolean().optional().describe("greys the button out and ignores clicks"),
    onClick: fn("called on click").optional(),
    type: z.enum(["button", "submit"]).optional().describe("default button"),
    children: node("the label"),
    menu: z.array(z.object({ label: z.string(), onSelect: fn("called when the item is picked") })).optional().describe("when present the button becomes a split button with a More menu"),
  }),
  example: `<Button variant="app" icon="plus" onClick={add}>Add</Button>`,
});
