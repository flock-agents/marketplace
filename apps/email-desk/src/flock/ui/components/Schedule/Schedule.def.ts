import { defineComponent } from "../../define";
import { Schedule } from "./Schedule";
import { ScheduleSchema } from "./Schedule.schema";
export const ScheduleDef = defineComponent({ ...ScheduleSchema, component: Schedule });
