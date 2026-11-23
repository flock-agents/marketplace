import { defineComponent } from "../../define";
import { BigCard } from "./BigCard";
import { BigCardSchema } from "./BigCard.schema";
export { BigCardFields } from "./BigCard.schema";
export const BigCardDef = defineComponent({ ...BigCardSchema, component: BigCard });
