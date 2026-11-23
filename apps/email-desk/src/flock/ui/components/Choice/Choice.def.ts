import { defineComponent } from "../../define";
import { Choice } from "./Choice";
import { ChoiceSchema } from "./Choice.schema";
export const ChoiceDef = defineComponent({ ...ChoiceSchema, component: Choice });
