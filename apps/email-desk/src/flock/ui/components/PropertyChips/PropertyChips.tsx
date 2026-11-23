import "./chips.css";
import type { ToneT } from "../../tone";
import { Value, type ValueKind } from "../Value/Value";
export interface PropertyChipsProps { items: { label: string; value: unknown; kind?: ValueKind; tones?: Record<string, ToneT> }[] }
export function PropertyChips({ items }: PropertyChipsProps) {
  return (
    <ul className="fl-props">
      {items.map((it, i) => (
        <li className="fl-prop" key={`${it.label}-${i}`}><i>{it.label}</i><Value kind={it.kind ?? "text"} value={it.value} tones={it.tones} /></li>
      ))}
    </ul>
  );
}
