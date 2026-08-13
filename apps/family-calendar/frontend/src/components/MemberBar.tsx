import type { Member } from "@shared/types";

interface Props {
  members: Member[];
  visibleMembers: Set<number | null>;
  onToggle: (id: number) => void;
}

export function MemberBar({ members, visibleMembers, onToggle }: Props) {
  if (members.length === 0) return null;

  return (
    <div className="members-bar">
      <span className="members-label">Members</span>
      <div className="members-chips">
        {members.map((m) => {
          const active = visibleMembers.has(m.id);
          return (
            <button
              key={m.id}
              className={`member-chip ${active ? "active" : "dimmed"}`}
              style={active ? { "--member-color": m.color } as React.CSSProperties : undefined}
              onClick={() => onToggle(m.id)}
            >
              <span className="member-emoji">{m.emoji}</span>
              <span className="member-name">{m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
