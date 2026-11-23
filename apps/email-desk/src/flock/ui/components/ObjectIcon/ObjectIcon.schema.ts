import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const ObjectIconSchema = defineSchema({
  name: "ObjectIcon", group: "media",
  description: "A themed sticker illustration from the app's objects folder, for empty states and cards; use Icon below 24px.",
  chat: {
    use: "a picture of a thing",
    avoid: "anything the reader needs to understand; a name not in icons.md",
    needs: "`name` exactly one of the names in icons.md, in this skill's folder (an unknown name draws an empty tile); `size` 24, 32, 48, 64 or 96",
    example: {"type": "Card", "props": {"title": "Gas refill", "meta": "Booked, arrives Friday"}, "children": [{"type": "ObjectIcon", "props": {"name": "gas-stove", "size": 48, "label": "Gas stove"}}]},
  },
  props: z.object({
    name: z.string().describe("object file name without .svg, e.g. 'house'; unknown names render nothing"),
    size: z.union([z.literal(24), z.literal(32), z.literal(48), z.literal(64), z.literal(96)]).optional().describe("pixels, default 48"),
    label: z.string().optional().describe("accessible name; omit when purely decorative"),
  }),
  example: `<ObjectIcon name="house" size={64} />`,
});
