import { z } from "zod";
import { defineComponent } from "../../define";
import { FileRow } from "./FileRow";
export const FileRowDef = defineComponent({
  name: "FileRow", group: "media", component: FileRow,
  description: "A file with a type badge, name and size; the name links out when the URL is http, https or mailto.",
  props: z.object({
    name: z.string().describe("file name; its extension picks the badge"),
    size: z.number().nonnegative().optional().describe("bytes, shown as KB/MB"),
    href: z.string().optional().describe("link target; unsafe schemes are not linked"),
    kind: z.string().optional().describe("badge text overriding the extension, e.g. 'csv'"),
  }),
  example: `<FileRow name="Invoice.pdf" size={48213} href={row.url} />`,
});
