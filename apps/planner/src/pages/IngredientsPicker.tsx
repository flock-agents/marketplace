import "./pantry.css";
import { useState } from "react";
import { Field } from "../flock/ui";
import { matchIngredients, type Ingredient } from "./ingredients";

interface Props {
  name: string; label: string; value: string; placeholder?: string;
  ingredients: Ingredient[];
  onChange: (text: string) => void;
  onPick: (ingredient: Ingredient) => void;   // a suggestion was chosen (click or Enter)
  onEnter?: () => void;                         // Enter with no suggestion highlighted
}

/** A text field that suggests catalog ingredients as you type (names and aliases, typo-tolerant); ↑/↓ move, Enter picks, Esc closes. */
export function IngredientsPicker({ name, label, value, placeholder, ingredients, onChange, onPick, onEnter }: Props) {
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(true);
  const matches = open ? matchIngredients(ingredients, value, 6).filter((m) => m.row.name.toLowerCase() !== value.trim().toLowerCase()) : [];
  const pick = (i: Ingredient) => { onPick(i); setOpen(false); setActive(-1); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
    else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); setActive((a) => (a <= 0 ? matches.length - 1 : a - 1)); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
    else if (e.key === "Enter") {
      if (active >= 0 && matches[active]) { e.preventDefault(); pick(matches[active].row); }
      else if (onEnter) { e.preventDefault(); onEnter(); }
    }
  };

  return (
    <div className="pl-picker" onKeyDown={onKeyDown} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <Field type="text" name={name} label={label} value={value} placeholder={placeholder}
        onChange={(v) => { onChange((v as string | null) ?? ""); setOpen(true); setActive(-1); }} />
      {matches.length ? (
        <ul className="pl-picker-list" role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((m, i) => (
            <li key={m.row.id} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} className="pl-picker-opt" data-active={i === active || undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.row)}>
                <span>{m.row.name}</span>{m.via ? <small>{m.via}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
