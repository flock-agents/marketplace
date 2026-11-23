import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { DateRange } from "./DateRange";
export const DateRangeDef = defineComponent({
  name: "DateRange", group: "inputs", component: DateRange,
  description: "From and To date pickers with quick presets (this week, this month, last 30 days, this year).",
  props: z.object({
    from: z.string().nullable().describe("ISO date YYYY-MM-DD, or null"), to: z.string().nullable().describe("ISO date YYYY-MM-DD, or null"),
    onChange: fn("called with { from, to }"),
    presets: z.array(z.enum(["this-week", "this-month", "last-30", "this-year"])).optional().describe("which quick buttons to show; all four by default, [] for none"),
    today: z.string().optional().describe("ISO date to treat as today; for tests and demos"),
  }),
  example: `<DateRange from={range.from} to={range.to} onChange={setRange} presets={["this-month", "last-30"]} />`,
});
