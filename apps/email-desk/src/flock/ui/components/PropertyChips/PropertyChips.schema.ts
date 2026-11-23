import { z } from "zod";
import { defineSchema } from "../../schema-def";
import { Tone } from "../../tone";
import { ValueKindSchema } from "../Value/kind";
export const PropertyChipsSchema = defineSchema({
  name: "PropertyChips", group: "records",
  description: "A wrapping row of small label and value chips, for a record's key facts.",
  chat: {
    use: "3 to 6 short facts as chips",
    avoid: "long values or many fields (a Detail)",
    needs: "short values; numbers with `kind`",
    example: {"type": "PropertyChips", "props": {"items": [{"label": "Rent", "value": 32000, "kind": "money"}, {"label": "Area", "value": "Indiranagar"}, {"label": "Size", "value": "2 BHK"}, {"label": "Deposit", "value": "3 months"}]}},
  },
  props: z.object({
    items: z.array(z.object({ label: z.string(), value: z.unknown(), kind: ValueKindSchema.optional().describe("text by default"), tones: z.record(z.string(), Tone).optional().describe("select only: option → tone") })).describe("label and value pairs shown as small chips; kind says how to show each value"),
  }),
  example: `<PropertyChips items={[{ label: "Cost", value: 1200, kind: "money" }, { label: "Where", value: "Goa" }]} />`,
});
