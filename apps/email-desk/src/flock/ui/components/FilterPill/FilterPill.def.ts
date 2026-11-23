import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { FilterPill } from "./FilterPill";
export const FilterPillDef = defineComponent({
  name: "FilterPill", group: "inputs", component: FilterPill,
  description: "A pill-shaped dropdown filter: the field name in grey, the chosen option, and Any for none.",
  props: z.object({
    label: z.string().describe("the field name, e.g. Status"), options: z.array(z.string()).describe("the choices offered, besides Any"),
    value: z.string().nullable().describe("the chosen option, or null for Any"),
    onChange: fn("called with the option, or null when Any is picked"),
  }),
  example: `<FilterPill label="Status" options={["Open", "Done"]} value={status} onChange={setStatus} />`,
});
