import { ValueKindSchema } from "../Value/kind";
import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const StatStripSchema = defineSchema({
  name: "StatStrip", group: "data",
  description: "One row of 2–5 key numbers; never a grid of number cards.",
  chat: {
    use: "2 to 5 figures in one row",
    avoid: "one figure (a HeroStat); more than 5 (a Table or a Chart)",
    needs: "2 to 5 `stats`; `label`s of 1 or 2 words; every `value` a JSON number with `kind`",
    example: {"type": "StatStrip", "props": {"stats": [{"label": "Spent", "value": 86100, "kind": "money", "delta": -8}, {"label": "Budget", "value": 95000, "kind": "money"}, {"label": "Bills paid", "value": 7}, {"label": "Bills due", "value": 2}]}},
  },
  props: z.object({
    stats: z.array(z.object({
      label: z.string(), value: z.union([z.number(), z.string()]),
      kind: ValueKindSchema.optional().describe("number (default for numbers), money, compact, share, minutes, text; share shows a plain 64%, percent a signed change (+12.0%)"),
      delta: z.number().optional().describe("percent change, shown green or red"), hint: z.string().optional().describe("tooltip"),
    })).max(5).describe("2 to 5 stats, shown in one row"),
  }),
  example: `<StatStrip stats={[{ label: "done", value: 24 }, { label: "spent", value: 84200, kind: "money", delta: 12 }]} />`,
});
