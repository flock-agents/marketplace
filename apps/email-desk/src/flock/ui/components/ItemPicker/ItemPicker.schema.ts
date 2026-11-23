import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
export const ItemPickerSchema = defineSchema({
  name: "ItemPicker", group: "inputs",
  description: "Items with a photo, price and a quantity stepper, in group tabs, and one button that sends the picks.",
  chat: {
    use: "picking how many of each from a menu or a shop's results, to order or add to a cart",
    avoid: "one option out of a few (a Choice of cards); a list with nothing to pick (a RowList)",
    needs: "`price` rupees as a number; `meta` one short line (Veg · 4.2★, 12 pcs); `image` the exact address a tool or page gave, else none; `group` the menu's sections (at most 8); 40 items at most; an `id`; the title on a MiniApp around it",
    example: {"type": "MiniApp", "id": "leons-menu", "props": {"title": "Leon's Grill"}, "children": [{"type": "ItemPicker", "id": "order", "props": {"items": [{"id": "cfb", "name": "Chicken Fillet Burger", "meta": "Non-veg · 4.2★", "price": 269, "group": "Bestsellers", "image": "https://media-assets.swiggy.com/swiggy/image/upload/FOOD_CATALOG/IMAGES/CMS/2025/12/8/4ef9a20d-5643-4fe9-a26c-6b51d76c8769_2c21458a-6108-4371-a1b0-6cc8765e5d83.png_compressed"}, {"id": "wings", "name": "Hot Wings", "price": 189, "group": "Wings"}]}}]},
  },
  props: z.object({
    items: z.array(z.object({
      id: z.string(),
      name: z.string(),
      meta: z.string().optional().describe("one short line under the name: veg or not, rating, pack size"),
      price: z.union([z.number(), z.string()]).optional().describe("the price of one, in rupees"),
      image: z.string().optional().describe("a photo of the item: an https address exactly as a tool or the page gave it"),
      group: z.string().optional().describe("the section it is in (a menu's Bestsellers, Combos); with 2 or more groups each is a tab"),
      max: z.number().int().positive().optional().describe("the most of it one order takes; default 20"),
    })).min(1).max(40).describe("the items to pick from, in the order to show them"),
    submitLabel: z.string().optional().describe("the button that sends the picks; default 'Add to cart'"),
    onSubmit: fn("called with [{ id, name, qty }] for every item picked"),
  }),
  example: `<ItemPicker items={menu.map((d) => ({ id: d.id, name: d.name, price: d.price, image: d.photo, group: d.section }))} onSubmit={(picked) => addToCart(picked)} />`,
});
