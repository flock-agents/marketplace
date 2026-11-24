import { defineComponent } from "../../define";
import { Card } from "./Card";
import { CardSchema } from "./Card.schema";
export const CardDef = defineComponent({ ...CardSchema, component: Card });
