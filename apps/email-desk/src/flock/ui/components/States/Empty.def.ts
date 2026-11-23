import { z } from "zod";
import { defineComponent, node } from "../../define";
import { Empty } from "./Empty";
export const EmptyDef = defineComponent({
  name: "Empty", group: "states", component: Empty,
  description: "The no-data state: a title, a hint, an optional object illustration and an action.",
  props: z.object({
    title: z.string().describe("what is missing, e.g. 'No invoices yet'"),
    hint: z.string().optional().describe("what to do about it"),
    object: z.string().optional().describe("object name drawn above the title"),
    action: node("usually a Button").optional(),
  }),
  example: `<Empty title="No invoices yet" hint="Add the first one." object="receipt" action={<Button onClick={add}>Add invoice</Button>} />`,
});
