import { useState } from "react";
import { Button, Card, Confirm, Empty, Form, InlinePanel, RowList, Section, useTable, useToast } from "../flock/ui";
import { COLOUR_LABELS, memberFields, undo, type Member, type Selected } from "./shared";

interface Props { family: ReturnType<typeof useTable<Member>>; selected: Selected; onSelect: (s: Selected) => void }

/** The family, under the week: who is who, with their emoji and colour. Add opens under the heading; a tap opens the member in place. */
export function FamilyList({ family, selected, onSelect }: Props) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const picked = selected?.table === "members" ? family.rows.find((m) => m.id === selected.id) : undefined;
  const pick = (m: Member) => onSelect(selected?.id === m.id ? null : { table: "members", id: m.id, label: m.name });
  const add = async (v: Record<string, unknown>) => { await family.create(v as Partial<Member>); setAdding(false); };
  const remove = async (m: Member) => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await family.remove(m.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Removed ${m.name}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => undo(changeId!, () => toast.show({ message: "Couldn't undo", tone: "danger" })) } : undefined });
  };
  return (
    <Section title="Family" emphasis="subtle" actions={<Button size="sm" variant="soft" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New member" onClose={() => setAdding(false)}>
          <Card title="New member"><Form fields={[...memberFields]} initial={{ colour: "accent" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} /></Card>
        </InlinePanel>
      ) : null}
      <RowList
        rows={family.rows} loading={family.loading} error={family.error} hasMore={family.hasMore} onLoadMore={family.loadMore}
        leading={(m) => <span aria-hidden="true">{m.emoji ?? "•"}</span>}
        title={(m) => m.name} meta={(m) => COLOUR_LABELS[m.colour] ?? m.colour}
        onRowClick={pick}
        empty={<Empty title="No one in the family yet" hint="Add each person, so events can say who they are for." />}
        // The picked member opens in place, under their row.
        expanded={picked ? {
          at: picked.id, label: `Edit ${picked.name}`, onClose: () => onSelect(null),
          content: (
            <Card title={`Edit ${picked.name}`} actions={<Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Remove</Button>}>
              <Form key={picked.id} fields={[...memberFields]} initial={{ ...picked }} onCancel={() => onSelect(null)} onSubmit={async (v) => { await family.update(picked.id, v as Partial<Member>); onSelect(null); }} />
              <Confirm open={asking} title={`Remove ${picked.name}?`} body="Their events stay, with the name on them. You can undo it for a few seconds." confirmLabel="Remove" tone="danger" onConfirm={() => void remove(picked)} onCancel={() => setAsking(false)} />
            </Card>
          ),
        } : null}
      />
    </Section>
  );
}
