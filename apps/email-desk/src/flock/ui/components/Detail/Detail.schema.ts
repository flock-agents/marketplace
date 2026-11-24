import { z } from "zod";
import { defineSchema } from "../../schema-def";
import { Tone } from "../../tone";
import { ValueKindSchema } from "../Value/kind";
export const DetailSchema = defineSchema({
  name: "Detail", group: "records",
  description: "Label and value pairs for one record, each value formatted by its kind.",
  chat: {
    use: "labelled fields of one thing (a policy, a booking)",
    avoid: "a Table with one row; Bullets of \"Label: value\"",
    needs: "at most 10 `fields`; each value text, or a JSON number with `kind` (money in rupees; date YYYY-MM-DD); never an object as a value",
    example: {"type": "Detail", "props": {"fields": [{"label": "Policy", "value": "Star Health Family Optima"}, {"label": "Insured", "value": "Ravi, Anita, Kabir"}, {"label": "Cover", "value": 1000000, "kind": "money"}, {"label": "Premium", "value": 24500, "kind": "money"}, {"label": "Renews", "value": "2027-03-14", "kind": "date"}]}},
  },
  props: z.object({
    fields: z.array(z.object({
      label: z.string(), value: z.unknown().describe("text, or a number formatted by kind (rupees for money, YYYY-MM-DD for a date)"),
      kind: ValueKindSchema.optional().describe("how to show the value; text by default"),
      tones: z.record(z.string(), Tone).optional().describe("for kind select: value to tone"),
      labels: z.record(z.string(), z.string()).optional().describe("for kind select: stored value to the words shown"),
    })).describe("label and value pairs, in order; kind says how to show each value"),
    sample: z.boolean().optional().describe("pass the record's _sample: the values are lighter and a Sample chip heads the list"),
  }),
  example: `<Detail fields={[{ label: "Owner", value: row.owner, kind: "person" }, { label: "Budget", value: row.budget, kind: "money" }]} />`,
});
