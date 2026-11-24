import { defineComponent } from "../../define";
import { Callout } from "./Callout";
import { CalloutSchema } from "./Callout.schema";
export const CalloutDef = defineComponent({ ...CalloutSchema, component: Callout });
