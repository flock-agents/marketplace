import { defineComponent } from "../../define";
import { ProductCards } from "./ProductCards";
import { ProductCardsSchema } from "./ProductCards.schema";
export const ProductCardsDef = defineComponent({ ...ProductCardsSchema, component: ProductCards });
