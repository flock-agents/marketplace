import { z } from "zod";
/** The one list of value kinds. `percent` is a signed change ("+12.0%", green or red); `share` is a plain "64%". */
export const VALUE_KINDS = ["text","number","money","compact","signed","percent","share","date","select","multi","person","url","checkbox","minutes"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];
/** Schema twin of ValueKind, shared by the data components' prop definitions. */
export const ValueKindSchema = z.enum(VALUE_KINDS);
