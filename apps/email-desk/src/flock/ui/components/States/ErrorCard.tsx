import "./states.css";
import { Button } from "../Button/Button";
export interface ErrorCardProps { title?: string; message: string; onRetry?: () => void }
export function ErrorCard({ title, message, onRetry }: ErrorCardProps) {
  return (
    <div role="alert" className="fl-error">
      {title ? <b>{title}</b> : null}<span>{message}</span>
      {onRetry ? <Button variant="soft" size="sm" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}
