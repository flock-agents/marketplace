import { defineComponent } from "../../define";
import { Detail } from "./Detail";
import { DetailSchema } from "./Detail.schema";
export const DetailDef = defineComponent({ ...DetailSchema, component: Detail });
