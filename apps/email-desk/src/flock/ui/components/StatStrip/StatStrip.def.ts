import { defineComponent } from "../../define";
import { StatStrip } from "./StatStrip";
import { StatStripSchema } from "./StatStrip.schema";
export const StatStripDef = defineComponent({ ...StatStripSchema, component: StatStrip });
