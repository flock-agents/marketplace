import { defineComponent } from "../../define";
import { Heading } from "./Heading";
import { HeadingSchema } from "./Heading.schema";
export const HeadingDef = defineComponent({ ...HeadingSchema, component: Heading });
