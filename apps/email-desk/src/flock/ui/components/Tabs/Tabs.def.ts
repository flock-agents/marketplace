import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { Tabs } from "./Tabs";
export const TabsDef = defineComponent({
  name: "Tabs", group: "frame", component: Tabs,
  description: "Pill tabs for switching between views of a page; arrow keys move the selection.",
  props: z.object({
    tabs: z.array(z.object({
      id: z.string(), label: z.string(), count: z.number().optional().describe("small number shown after the label"),
      icon: z.string().optional().describe("lucide icon name shown before the label"),
    })).describe("the tabs, in order"),
    value: z.string().describe("id of the selected tab"),
    onChange: fn<(id: string) => void>("called with the id of the tab chosen"),
  }),
  example: `<Tabs tabs={[{ id: "board", label: "Board" }, { id: "list", label: "List", count: 12 }]} value={tab} onChange={setTab} />`,
});
