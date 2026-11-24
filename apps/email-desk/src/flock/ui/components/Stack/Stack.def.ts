import { z } from "zod";
import { defineComponent, node } from "../../define";
import { Row, Stack } from "./Stack";
const gap = z.enum(["xs", "sm", "md", "lg"]).optional();
export const StackDef = defineComponent({
  name: "Stack", group: "frame", component: Stack,
  description: "Children one under another, spaced by the scale. Space a custom block's parts with it, never with margins.",
  props: z.object({
    gap: gap.describe("space between children: xs, sm, md (default), lg"),
    align: z.enum(["start", "center", "end"]).optional().describe("cross-axis alignment; stretch when unset"),
    children: node("the things to stack"),
  }),
  example: `<Stack gap="sm"><Heading>Dinner</Heading><Value kind="money" value={420} /></Stack>`,
});
export const RowDef = defineComponent({
  name: "Row", group: "frame", component: Row,
  description: "Children side by side, spaced by the scale, wrapping. Inside a box, use it instead of Columns.",
  props: z.object({
    gap: gap.describe("space between children: xs, sm (default), md, lg"),
    align: z.enum(["start", "center", "end", "baseline"]).optional().describe("cross-axis alignment, center by default"),
    justify: z.enum(["start", "between", "end"]).optional().describe("main-axis placement; between pushes the first and last apart"),
    wrap: z.boolean().optional().describe("wrap onto more lines when they do not fit (default true)"),
    children: node("the things to lay side by side"),
  }),
  example: `<Row justify="between"><span>Total</span><Value kind="money" value={1240} /></Row>`,
});
