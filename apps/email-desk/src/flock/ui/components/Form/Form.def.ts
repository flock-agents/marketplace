import { defineComponent } from "../../define";
import { Form } from "./Form";
import { FormSchema } from "./Form.schema";
export const FormDef = defineComponent({ ...FormSchema, component: Form });
