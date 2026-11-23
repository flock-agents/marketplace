import { defineComponent } from "../../define";
import { Calendar } from "./Calendar";
import { CalendarSchema } from "./Calendar.schema";
export const CalendarDef = defineComponent({ ...CalendarSchema, component: Calendar });
