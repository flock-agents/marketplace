import { defineComponent } from "../../define";
import { Chart } from "./Chart";
import { ChartSchema } from "./Chart.schema";
export const ChartDef = defineComponent({ ...ChartSchema, component: Chart });
