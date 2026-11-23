import { ValueKindSchema } from "../Value/kind";
import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const HeroStatSchema = defineSchema({
  name: "HeroStat", group: "data",
  description: "One big number for the page's main figure; use at most once per page.",
  chat: {
    use: "the one main figure",
    avoid: "several figures (a StatStrip); the same figure again in a Progress or a caption",
    needs: "`value` a JSON number with `kind` (money in rupees; share for a rate or level); `label` of 4 words at most; `caption` one line; `delta` a percent change",
    example: {"type": "HeroStat", "props": {"label": "Spent in October", "value": 86100, "kind": "money", "delta": -8, "caption": "Rent and groceries are most of it"}},
  },
  props: z.object({
    label: z.string().describe("what the number measures"), value: z.number().describe("the big number, as a number (rupees for money), never text such as '₹1.4L'"),
    kind: ValueKindSchema.optional().describe("number (default), money, compact, share, minutes; share shows a plain 64%, percent a signed change"),
    delta: z.number().optional().describe("percent change"), caption: z.string().optional().describe("one line of context under the number"),
  }),
  example: `<HeroStat label="Spent in October" value={84200} kind="money" caption="12% over the plan · 9 days left" />`,
});
