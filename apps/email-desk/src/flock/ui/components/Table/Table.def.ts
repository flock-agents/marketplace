import { defineComponent } from "../../define";
import { Table } from "./Table";
import { TableSchema } from "./Table.schema";
export const TableDef = defineComponent({ ...TableSchema, component: Table });
