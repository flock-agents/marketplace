import { defineComponent } from "../../define";
import { Checklist } from "./Checklist";
import { ChecklistSchema } from "./Checklist.schema";
export const ChecklistDef = defineComponent({ ...ChecklistSchema, component: Checklist });
