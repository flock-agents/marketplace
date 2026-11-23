import { defineComponent } from "../../define";
import { Divider } from "./Divider";
import { DividerSchema } from "./Divider.schema";
export const DividerDef = defineComponent({ ...DividerSchema, component: Divider });
