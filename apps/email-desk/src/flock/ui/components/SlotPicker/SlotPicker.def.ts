import { defineComponent } from "../../define";
import { SlotPicker } from "./SlotPicker";
import { SlotPickerSchema } from "./SlotPicker.schema";
export const SlotPickerDef = defineComponent({ ...SlotPickerSchema, component: SlotPicker });
