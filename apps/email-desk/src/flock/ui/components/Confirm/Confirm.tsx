import "./confirm.css";
import { useId, useRef, type ReactNode } from "react";
import { Button } from "../Button/Button";
import { useModal } from "../../useModal";
export interface ConfirmProps {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; tone?: "danger" | "ink";
  onConfirm: () => void; onCancel: () => void;
}
export function Confirm({ open, title, body, confirmLabel = "Confirm", tone = "ink", onConfirm, onCancel }: ConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, ref, onCancel);
  if (!open) return null;
  return (
    <div className="fl-confirm-scrim" onClick={onCancel}>
      <div ref={ref} className="fl-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h4 id={titleId}>{title}</h4>
        {body ? <p>{body}</p> : null}
        <div className="fl-confirm-acts">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={tone === "danger" ? "danger" : "ink"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
