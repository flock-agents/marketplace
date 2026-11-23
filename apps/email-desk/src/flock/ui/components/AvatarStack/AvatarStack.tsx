import "./avatarstack.css";
import { Avatar } from "../Value/Value";
export interface AvatarStackProps { people: { name: string }[]; max?: number }
export function AvatarStack({ people, max = 4 }: AvatarStackProps) {
  if (!people.length) return null;
  const shown = people.slice(0, max), extra = people.length - shown.length;
  return (
    <span className="fl-avs" role="group" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p, i) => <Avatar key={i} name={p.name} />)}
      {extra > 0 ? <i className="fl-avatar fl-av-more">+{extra}</i> : null}
    </span>
  );
}
