import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
export const LineItemsSchema = defineSchema({
  name: "LineItems", group: "records",
  description: "Editable invoice lines (description, qty, price, GST %) with line amounts and a subtotal, tax and total block.",
  chat: {
    use: "a bill or quote with GST totals",
    avoid: "amounts without quantities (a Table)",
    needs: "every row has `description`, `qty`, `unit_price` (rupees) and `gst_rate` (percent), null when not known; `noTax` for a seller not registered for GST; read-only in chat",
    example: {"type": "LineItems", "props": {"rows": [{"id": "1", "description": "Kitchen sink repair", "qty": 1, "unit_price": 1800, "gst_rate": 18}, {"id": "2", "description": "Tap cartridge", "qty": 2, "unit_price": 450, "gst_rate": 18}], "split": "intra"}},
  },
  props: z.object({
    rows: z.array(z.object({ id: z.string().optional(), description: z.string(), qty: z.number().nullable(), unit_price: z.number().nullable(), gst_rate: z.number().nullable() })).describe("the lines: description, qty, unit_price in rupees and gst_rate in percent"),
    onChange: fn("called with the whole new array of rows when a field changes or a row is added or removed; omit for a read-only block").optional(),
    rates: z.array(z.number()).optional().describe("the GST rates offered, default [0, 5, 18, 40]; a Custom % entry (0-100, two decimals) is always added"),
    split: z.enum(["intra", "inter", "none"]).optional().describe("intra shows CGST and SGST halves (default), inter shows IGST, none one Tax line"),
    totals: z.array(z.object({ label: z.string(), value: z.number(), strong: z.boolean().optional() })).optional().describe("the totals block to show instead of the one worked out here, e.g. from the server; the last row is the grand total"),
    readOnly: z.boolean().optional().describe("show the rows as text even when onChange is set"),
    addLabel: z.string().optional().describe("label of the add-a-row button, default 'Add a line'"),
    noTax: z.boolean().optional().describe("the seller is not registered for GST: no GST column or rate pickers, no tax in the worked-out totals, new lines at 0%"),
  }),
  example: `<LineItems rows={lines} onChange={setLines} split={sameState ? "intra" : "inter"} />`,
});
