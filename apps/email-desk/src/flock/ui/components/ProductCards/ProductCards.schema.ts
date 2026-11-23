import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
const photo = z.object({
  image: z.string().describe("a photo: an https address exactly as the page gave it"),
  alt: z.string().optional().describe("what the photo shows (front, back, detail)"),
});

export const ProductCardsSchema = defineSchema({
  name: "ProductCards", group: "inputs",
  description: "Product cards with photos per colour, colour and size picks that switch price and stock, a cart and one Checkout.",
  chat: {
    use: "any product bought from a shop (clothes, gifts, gadgets), sized or not, put in a cart, checked out",
    avoid: "food and groceries (an ItemPicker); a choice that is not a purchase (a Choice)",
    needs: "only what was read from the site in this chat, never copied from memory or a past chat (prices, stock and ids go stale); 3 to 5 items read in full (up to 10 shown); every colour the site sells, each with its own `photos` read from the page (an item with no colours: its `photos`, and one `variants` row); `sizes` only those read; a `variants` row for every colour × size read, with the site's own variant id as `id` (Amazon: the ASIN; never a made-up id) and only the price, delivery and stock you read; `pickedSize` the owner's size; an `id`; the title on a MiniApp around it",
    example: {"type": "MiniApp", "id": "linen-shirts", "props": {"title": "Linen shirts"}, "children": [{"type": "ProductCards", "id": "shirts", "props": {"pickedSize": "M", "items": [{"id": "majestic", "title": "Striped Linen Shirt", "brand": "Majestic Man", "colours": [{"name": "Blue stripe", "photos": [{"image": "https://m.media-amazon.com/images/I/61rB.jpg"}]}], "sizes": ["M", "L"], "variants": [{"id": "B0BLUEM", "colour": "Blue stripe", "size": "M", "price": 474, "delivery": "Tomorrow", "available": true}, {"id": "B0BLUEL", "colour": "Blue stripe", "size": "L", "available": false}]}]}}]},
  },
  props: z.object({
    items: z.array(z.object({
      id: z.string(),
      title: z.string(),
      brand: z.string().optional(),
      rating: z.object({ stars: z.number(), count: z.number().optional() }).optional().describe("as the page shows it"),
      badge: z.string().optional().describe("a label the page shows, such as Amazon's Choice"),
      bullets: z.array(z.string()).max(3).optional().describe("up to 3 short feature lines from the page"),
      details: z.string().max(1500).optional().describe("the longer description from the page, shown under More details"),
      url: z.string().optional().describe("the product page address; the title links to it"),
      photos: z.array(photo).max(4).optional().describe("the default photos, used for a colour with none of its own"),
      colours: z.array(z.object({
        name: z.string(),
        swatch: z.string().optional().describe("a css colour for the swatch"),
        image: z.string().optional().describe("a swatch photo address, when the page gives one"),
        photos: z.array(photo).max(4).optional().describe("this colour's photos, as the page shows them"),
      })).max(8).optional().describe("the colours on the card (every colour the site sells, or the first few of many)"),
      moreOptions: z.object({ colours: z.number().int().min(1).optional(), sizes: z.number().int().min(1).optional() }).optional()
        .describe("colours and sizes the site sells that are not read onto the card yet; a button asks you to read them all"),
      moreColours: z.number().int().min(1).optional().describe("how many more colours the site sells than are on the card; the card says so and links to the page"),
      sizes: z.array(z.string()).max(10).optional().describe("the sizes read, in order (up to 10)"),
      variants: z.array(z.object({
        id: z.string().describe("the site's variant id (an ASIN)"),
        colour: z.string().optional().describe("a colour name above"),
        size: z.string().optional().describe("a size above"),
        price: z.number().optional().describe("rupees; only when read"),
        mrp: z.number().optional().describe("rupees; only when read"),
        delivery: z.string().optional().describe("the delivery date as the page wrote it; only when read"),
        stock: z.string().optional().describe("a stock note such as Only 3 left; only when read"),
        available: z.boolean().describe("false when the page says it is not sold in this colour and size"),
      })).min(1).max(48).describe("one row for every colour and size read"),
    })).min(1).max(10).describe("up to 10 products, in the order to show them"),
    pickedSize: z.string().optional().describe("the owner's size; a card opens on a colour that has it"),
    submitLabel: z.string().optional().describe("the button that sends the cart; default 'Checkout'"),
    onSubmit: fn("called with [{ id, title, colour, size, variantId, price }] for every cart line"),
  }),
  example: `<ProductCards pickedSize="M" items={shirts} onSubmit={(cart) => checkout(cart)} />`,
});
