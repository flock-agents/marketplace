import { z } from "zod";
import { defineComponent, node } from "../../define";
import { ToastProvider } from "./Toast";
export const ToastDef = defineComponent({
  name: "ToastProvider", group: "states", component: ToastProvider,
  description: "Wrap the app once; then useToast().show({ message, tone?, action? }) shows a pill for 5 seconds.",
  props: z.object({ children: node("the app") }),
  example: `const { show } = useToast(); show({ message: "Saved", tone: "success", action: { label: "Undo", onClick: undo } });`,
});
