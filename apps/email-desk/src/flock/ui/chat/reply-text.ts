import type { Answer } from "../components/Choice/Choice";
import { clockLabel } from "../components/SlotPicker/SlotPicker";
import type { CartLine } from "../components/ProductCards/ProductCards";
import type { BlockNode } from "./validate";

/** What the chat shows (and the agent reads) when the user presses "Make it an app". */
export const MAKE_APP_TEXT = "Make this into an app";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const propsOf = (n: BlockNode): Record<string, any> => (isObj(n.props) ? n.props : {});

/** One answer as words; a written answer is quoted when it sits in a list of answers. */
function answerText(a: Answer, quoteWritten: boolean): string {
  if ("written" in a) return quoteWritten ? `“${a.written}”` : a.written;
  return a.picked.join(", ");
}

function fieldText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** The user's answer to a reply-capable node, in the words the agent will read. */
export function replyText(node: BlockNode, value: unknown): string {
  const props = propsOf(node);
  switch (node.type) {
    case "Choice": return answerText(value as Answer, false);
    case "Questions": {
      const answers = (isObj(value) ? value : {}) as Record<string, Answer>;
      const order = (node.children ?? []).map((c) => { const p = propsOf(c); return String(p.tab ?? p.question ?? ""); });
      const labels = [...order.filter((k) => k in answers), ...Object.keys(answers).filter((k) => !order.includes(k))];
      return labels.map((k) => `${k}: ${answerText(answers[k], true)}`).join("\n");
    }
    case "Checklist": {
      const ticked = new Set(Array.isArray(value) ? (value as string[]) : []);
      const items: { id: string; label: string }[] = Array.isArray(props.items) ? props.items : [];
      const done = items.filter((i) => ticked.has(i.id)).map((i) => i.label);
      const open = items.filter((i) => !ticked.has(i.id)).map((i) => i.label);
      return [done.length ? `Done: ${done.join(", ")}` : "", open.length ? `Not done: ${open.join(", ")}` : ""].filter(Boolean).join(" · ");
    }
    case "Form": {
      const values = isObj(value) ? value : {};
      const fields: { name: string; label: string }[] = Array.isArray(props.fields) ? props.fields : [];
      return fields.map((f) => `${f.label}: ${fieldText(values[f.name])}`).join("\n");
    }
    case "SlotPicker": {
      const s = value as { start: string; end: string };
      return `${clockLabel(s.start)}–${clockLabel(s.end)}`;
    }
    case "ItemPicker": {
      const picked: { name?: unknown; qty?: unknown }[] = Array.isArray(value) ? value : [];
      return picked.length ? `Add ${picked.map((p) => `${String(p.qty)} × ${String(p.name)}`).join(", ")}` : "Nothing picked";
    }
    case "ProductCards": {
      if (isObj(value) && "written" in value) return String(value.written);
      const lines: CartLine[] = Array.isArray(value) ? value : [];
      if (!lines.length) return "Nothing in the cart";
      const text = lines.map((l) => {
        const opt = [l.colour, l.size].filter(Boolean).join(", ");
        const what = `${l.title}${opt ? ` · ${opt}` : ""}`;
        return typeof l.price === "number" ? `${what} · ₹${l.price} (${l.variantId})` : `${what} (${l.variantId})`;
      });
      return lines.every((l) => typeof l.price === "number")
        ? [...text, `Total: ₹${lines.reduce((s, l) => s + (l.price as number), 0)}`].join("\n") : text.join("\n");
    }
    default: return typeof value === "string" ? value : JSON.stringify(value);
  }
}
