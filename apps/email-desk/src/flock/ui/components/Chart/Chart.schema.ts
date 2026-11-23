import { z } from "zod";
import { defineSchema } from "../../schema-def";
import { Tone } from "../../tone";
import { ValueKindSchema } from "../Value/kind";
export const ChartSchema = defineSchema({
  name: "Chart", group: "data",
  description: "A small line, bar or share (allocation) chart from rows; theme colours only.",
  chat: {
    use: "numbers over time (line), by category (bar) or parts of a whole (share)",
    avoid: "a Table or prose of numbers; amounts against their own limits (a ProgressList)",
    needs: "line: 5 or more points at even steps, oldest first; share: at most 6 slices of amounts; every series `key` a field on every data row; values JSON numbers; `kind` money for rupees; short labels; a Chart has no caption: a caveat about the data goes in the `subtitle` of a MiniApp around it",
    example: {"type": "MiniApp", "props": {"title": "Nifty 50", "subtitle": "Approximate month-end levels"}, "children": [{"type": "Chart", "props": {"type": "line", "data": [{"label": "May", "close": 24750}, {"label": "Jun", "close": 25480}, {"label": "Jul", "close": 24960}, {"label": "Aug", "close": 24430}, {"label": "Sep", "close": 25110}], "series": [{"key": "close", "label": "Nifty"}]}}]},
  },
  props: z.object({
    type: z.enum(["line", "bar", "share"]).describe("line and bar plot every series over the labels; share is one bar split by the first series' values"),
    data: z.array(z.object({ label: z.string() }).catchall(z.union([z.number(), z.string()]))).describe("one object per point: a label plus a number per series key (numbers, never text such as '₹1,200'); line points oldest first"),
    series: z.array(z.object({ key: z.string().describe("field on each data row"), label: z.string(), tone: Tone.optional().describe("defaults cycle through accent, info, success, warning, danger") })).describe("the lines or bars to draw: key (field on each data row), label and optional tone"),
    kind: ValueKindSchema.optional().describe("money or compact formats the y-axis as ₹ with k / L / Cr; share adds % (percent is the same here)"),
    height: z.number().optional().describe("plot height in px at full width (default 200); the chart scales down on phones"),
  }),
  example: `<Chart type="line" kind="money" data={[{ label: "May", income: 262000, expenses: 171000 }]} series={[{ key: "income", label: "Income", tone: "success" }, { key: "expenses", label: "Expenses", tone: "danger" }]} />`,
});
