import { defineComponent } from "../../define";
import { LineItems } from "./LineItems";
import { LineItemsSchema } from "./LineItems.schema";
export const LineItemsDef = defineComponent({ ...LineItemsSchema, component: LineItems });
