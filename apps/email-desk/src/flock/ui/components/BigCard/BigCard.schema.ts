import { z } from "zod";
import { defineSchema } from "../../schema-def";
import { ValueKindSchema } from "../Value/kind";
export const BigCardFields = {
  label: z.string().optional().describe("small uppercase tag above the title, e.g. 'Option A'"),
  title: z.string().describe("the card's name or headline"),
  value: z.union([z.string(), z.number()]).optional().describe("the big figure shown on the card: a price, a time or a count; leave it out when there is none, never an id or slug"),
  kind: ValueKindSchema.optional().describe("how to show the value: number (default for numbers), money, compact, share, minutes, text"),
  unit: z.string().optional().describe("small unit after the value, e.g. '/ month'"),
  caption: z.string().optional().describe("one or two lines of context under the value"),
  chips: z.array(z.string()).optional().describe("short facts shown as chips"),
  image: z.string().optional().describe("a photo of the option (a product, a dish, a place): an https image address exactly as a tool or the site gave it, never made up"),
  facts: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), kind: ValueKindSchema.optional().describe("text by default; number for numbers") })).max(8).optional().describe("labelled rows under the caption, for comparing cards side by side: give every card the same labels in the same order (at most 8)"),
};
export const BigCardSchema = defineSchema({
  name: "BigCard", group: "data",
  description: "A large card with a title, an optional big value, a caption and chips; for a highlighted option or fact.",
  chat: {
    use: "a Choice's card option, or one highlighted fact",
    avoid: "a record with a meta line (Card); a figure on its own (HeroStat)",
    needs: "`title` of 30 characters at most; `value` only a figure (a number; rupees for money), never an id: leave it out when there is none; `caption` one line (a card cuts it at two); `chips` at most 2, short; `facts` at most 6 rows, the same labels in the same order on every card; `image` only an address a tool or page gave",
    example: {"type": "BigCard", "props": {"label": "Best rate", "title": "SBI FD, 2 years", "value": 7.25, "kind": "share", "caption": "Highest of the big banks this month", "chips": ["No lock-in"], "facts": [{"label": "Payout", "value": "At maturity"}, {"label": "Minimum", "value": 1000, "kind": "money"}]}},
  },
  props: z.object(BigCardFields),
  example: `<BigCard label="Plan B" title="Annual" value={9900} kind="money" unit="/ year" caption="Two months free" chips={["Cancel anytime"]} />`,
});
