import { defineComponent } from "../../define";
import { Columns } from "./Columns";
import { ColumnsSchema } from "./Columns.schema";
export const ColumnsDef = defineComponent({ ...ColumnsSchema, component: Columns });
