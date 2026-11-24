import { defineComponent } from "../../define";
import { PropertyChips } from "./PropertyChips";
import { PropertyChipsSchema } from "./PropertyChips.schema";
export const PropertyChipsDef = defineComponent({ ...PropertyChipsSchema, component: PropertyChips });
