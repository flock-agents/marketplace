import { ValueKindSchema } from "../Value/kind";
import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const ProgressSchema = defineSchema({
  name: "Progress", group: "data",
  description: "A value against a limit; turns red when over.",
  chat: {
    use: "one amount against its own limit",
    avoid: "several amounts (a ProgressList); a figure a HeroStat already shows",
    needs: "`value` and `limit` (above 0) as JSON numbers, with `kind`",
    example: {"type": "Progress", "props": {"label": "Groceries, October", "value": 9200, "limit": 8000, "kind": "money"}},
  },
  props: z.object({
    value: z.number().describe("how much has been used or reached"), limit: z.number().describe("the target or budget; the bar turns red when value is above it"),
    label: z.string().optional().describe("text shown above the bar"), showValue: z.boolean().optional().describe("false hides the 'value / limit' text, for when a heading already says it"),
    kind: ValueKindSchema.optional().describe("number (default), money, compact, share, minutes; share shows a plain 64%, percent a signed change"),
  }),
  example: `<Progress label="Groceries" value={9200} limit={8000} kind="money" />`,
});
export const ProgressListSchema = defineSchema({
  name: "ProgressList", group: "data",
  description: "Several Progress rows stacked so their labels, bars and values line up in shared columns (budgets).",
  chat: {
    use: "amounts, each against its own limit (budgets by category)",
    avoid: "parts of one total (a share Chart): never give every row the total as its limit",
    needs: "each item's own `limit`; numbers with `kind`; at most 8 rows",
    example: {"type": "ProgressList", "props": {"items": [{"label": "Groceries", "value": 9200, "limit": 8000, "kind": "money"}, {"label": "Eating out", "value": 3100, "limit": 5000, "kind": "money"}, {"label": "Fuel", "value": 4600, "limit": 6000, "kind": "money"}]}},
  },
  props: z.object({
    items: z.array(z.object({
      label: z.string().describe("row label"), value: z.number().describe("how much has been used"), limit: z.number().describe("the budget; the bar turns red when value is above it"),
      kind: ValueKindSchema.optional().describe("number (default), money, compact, share, minutes; share shows a plain 64%, percent a signed change"),
    })).describe("the rows to stack"),
  }),
  example: `<ProgressList items={[{ label: "Groceries", value: 9200, limit: 8000, kind: "money" }, { label: "Transport", value: 1500, limit: 4000, kind: "money" }]} />`,
});
