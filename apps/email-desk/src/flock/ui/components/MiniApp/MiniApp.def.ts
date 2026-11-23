import { defineComponent } from "../../define";
import { MiniApp } from "./MiniApp";
import { Tab } from "./Tab";
import { MiniAppSchema, TabSchema } from "./MiniApp.schema";
export const MiniAppDef = defineComponent({ ...MiniAppSchema, component: MiniApp });
export const TabDef = defineComponent({ ...TabSchema, component: Tab });
