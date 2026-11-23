import { defineComponent } from "../../define";
import { RowList } from "./RowList";
import { RowListSchema } from "./RowList.schema";
export const RowListDef = defineComponent({ ...RowListSchema, component: RowList });
