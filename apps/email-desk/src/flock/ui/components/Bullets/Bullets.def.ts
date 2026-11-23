import { defineComponent } from "../../define";
import { Bullets } from "./Bullets";
import { BulletsSchema } from "./Bullets.schema";
export const BulletsDef = defineComponent({ ...BulletsSchema, component: Bullets });
