import { defineComponent } from "../../define";
import { Field } from "./Field";
import { FieldSchema } from "./Field.schema";
export { FieldTypeSchema } from "./Field.schema";
export const FieldDef = defineComponent({ ...FieldSchema, component: Field });
