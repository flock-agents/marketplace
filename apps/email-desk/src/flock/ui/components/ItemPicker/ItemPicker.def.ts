import { defineComponent } from "../../define";
import { ItemPicker } from "./ItemPicker";
import { ItemPickerSchema } from "./ItemPicker.schema";
export const ItemPickerDef = defineComponent({ ...ItemPickerSchema, component: ItemPicker });
