import { z } from "zod";
import { defineComponent, fn, node } from "../../define";
import { Confirm } from "./Confirm";
export const ConfirmDef = defineComponent({
  name: "Confirm", group: "states", component: Confirm,
  description: "A small modal that asks before something risky; focus starts on Cancel and Escape cancels.",
  props: z.object({
    open: z.boolean().describe("whether the dialog is showing"),
    title: z.string().describe("the question, e.g. 'Delete this invoice?'"),
    body: node("one line of consequence").optional(),
    confirmLabel: z.string().optional().describe("button text, default 'Confirm'"),
    tone: z.enum(["danger", "ink"]).optional().describe("danger for destructive actions, default ink"),
    onConfirm: fn<() => void>("runs when the owner confirms"),
    onCancel: fn<() => void>("runs on Cancel, Escape or a click outside"),
  }),
  example: `<Confirm open={ask} title="Delete invoice?" tone="danger" confirmLabel="Delete" onConfirm={del} onCancel={() => setAsk(false)} />`,
});
