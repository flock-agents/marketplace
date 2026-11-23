import { defineComponent } from "../../define";
import { ObjectIcon } from "./ObjectIcon";
import { ObjectIconSchema } from "./ObjectIcon.schema";
export const ObjectIconDef = defineComponent({ ...ObjectIconSchema, component: ObjectIcon });
