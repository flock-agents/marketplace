import { defineComponent } from "../../define";
import { Button } from "./Button";
import { ButtonSchema } from "./Button.schema";
export const ButtonDef = defineComponent({ ...ButtonSchema, component: Button });
