import { useState, type ReactNode } from "react";
import { Confirm, kitFetch, useToast } from "../flock/ui";

/** Delete with a question first and an Undo afterwards (through the kit's change log). `dialog` goes anywhere in the page. */
export function useDelete<R extends { id: string }>(remove: (id: string) => Promise<string | undefined>, noun: string, describe: (row: R) => string): { ask: (row: R) => void; dialog: ReactNode } {
  const toast = useToast();
  const [asking, setAsking] = useState<R | null>(null);
  const run = async (row: R) => {
    setAsking(null);
    let changeId: string | undefined;
    try { changeId = await remove(row.id); } catch { return; }   // the hook already said why
    toast.show({
      message: `Deleted ${describe(row)}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
  };
  const dialog = <Confirm open={!!asking} title={`Delete this ${noun}?`} body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={() => asking && void run(asking)} onCancel={() => setAsking(null)} />;
  return { ask: setAsking, dialog };
}
