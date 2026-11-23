import { z } from "zod";
import { defineComponent } from "../../define";
import { Image } from "./Image";
export const ImageDef = defineComponent({
  name: "Image", group: "media", component: Image,
  description: "A picture at a fixed ratio; an empty or broken source shows a placeholder, optionally with an object.",
  props: z.object({
    src: z.string().nullish().describe("http(s) URL or a /root-relative path; anything else shows the placeholder"),
    alt: z.string().describe("what the picture shows"),
    ratio: z.enum(["1:1", "4:3", "16:9"]).optional().describe("default 1:1"),
    object: z.string().optional().describe("object name drawn in the placeholder"),
  }),
  example: `<Image src={row.photo} alt={row.name} ratio="4:3" object="camera" />`,
});
