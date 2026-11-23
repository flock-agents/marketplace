import { defineComponent } from "../../define";
import { Progress, ProgressList } from "./Progress";
import { ProgressSchema, ProgressListSchema } from "./Progress.schema";
export const ProgressDef = defineComponent({ ...ProgressSchema, component: Progress });
export const ProgressListDef = defineComponent({ ...ProgressListSchema, component: ProgressList });
