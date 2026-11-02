import { useEffect, useState } from "react";
import { Button, Empty, ErrorCard, Page, RowList, Section, Skeleton, kitFetch, label, useToast } from "../flock/ui";

/** GET /api/pantry (server/pantryCheck.ts): what is in the kitchen, by kind, each with how sure the app is. */
export type PantryStatus = "bought" | "have" | "checked" | "assumed" | "low" | "out";
export interface PantryItem { ingredient_id: string; name: string; category: string | null; status: PantryStatus; since: string | null }
interface PantryView { groups: { kind: string; items: PantryItem[] }[] }
type Have = "yes" | "low" | "out";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parse = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

/** "today" / "yesterday" / "Tue" within the week / "Oct 12" before that. */
export function dayWord(date: string, today: string): string {
  const ago = daysBetween(date, today);
  if (ago <= 0) return "today";
  if (ago === 1) return "yesterday";
  const d = parse(date);
  return ago < 7 ? WEEKDAYS[d.getDay()] : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** How sure the app is that the item is at home, in a few words: "bought Tue", "assumed", "checked 3 days ago". */
export function sureLine(item: Pick<PantryItem, "status" | "since">, today: string): string {
  if (item.status === "low") return "running low";
  if (item.status === "out") return "out";
  if (item.status === "assumed" || !item.since) return "assumed";
  if (item.status === "checked") {
    const ago = daysBetween(item.since, today);
    return ago <= 0 ? "checked today" : ago === 1 ? "checked yesterday" : `checked ${ago} days ago`;
  }
  const day = dayWord(item.since, today);
  return item.status === "have" ? `you have it (said ${day})` : `bought ${day}`;
}

const HAVE_LABELS: Record<Have, string> = { yes: "Have it", low: "Running low", out: "Out" };
const STATUS_HAVE: Partial<Record<PantryStatus, Have>> = { low: "low", out: "out" };

/** The likeliest correction first ("Have it" for something marked low/out, else "Running low"), the rest after;
 *  never the answer the item already has. */
export function corrections(status: PantryStatus): Have[] {
  const order: Have[] = STATUS_HAVE[status] ? ["yes", "low", "out"] : ["low", "out", "yes"];
  return order.filter((h) => h !== STATUS_HAVE[status]);
}

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** The Pantry: what is in the kitchen. Nothing here needs doing — the agent asks about the few items that matter
 *  in chat; each row only offers a light correction for when something is off. */
export function PantryPage() {
  const toast = useToast();
  const [view, setView] = useState<PantryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const title = label("title.pantry", "Pantry");

  const load = () => {
    setError(null);
    kitFetch<PantryView>("pantry").then(setView).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load"));
  };
  useEffect(load, []);

  const [openId, setOpenId] = useState<string | null>(null);
  const openOf = (items: PantryItem[]) => {
    const item = items.find((i) => i.ingredient_id === openId);
    return item ? { at: item.ingredient_id, content: corrector(item), onClose: () => setOpenId(null), label: `Update ${item.name}` } : null;
  };

  const answer = async (item: PantryItem, have: Have) => {
    setBusy(item.ingredient_id);
    try {
      const res = await kitFetch<{ pantry: PantryView }>("pantry/answer", { method: "POST", body: JSON.stringify({ items: [{ ingredient_id: item.ingredient_id, have }] }) });
      setView(res.pantry);
      toast.show({ message: have === "yes" ? `Noted: ${item.name} is here` : `${item.name} is on the shopping list`, tone: "success" });
    } catch { toast.show({ message: "Couldn't save that — try again", tone: "danger" }); }
    finally { setBusy(null); }
  };

  if (error) return <Page title={title}><ErrorCard title="Couldn't load the pantry" message={error} onRetry={load} /></Page>;
  if (!view) return <Page title={title}><Skeleton variant="card" lines={6} /></Page>;

  const today = localToday();
  // Tapping an item opens its corrections under it (the Shopping page's pattern); nothing sits on the row itself,
  // so no row reads as if it were running low.
  const corrector = (item: PantryItem) => (
    <div className="pl-pantry-actions">
      {corrections(item.status).map((h) => (
        <Button key={h} size="sm" variant={h === "yes" ? "soft" : "ghost"} disabled={busy === item.ingredient_id}
          onClick={async () => { await answer(item, h); setOpenId(null); }}>{HAVE_LABELS[h]}</Button>
      ))}
    </div>
  );

  return (
    <Page title={title} subtitle="What's in the kitchen">
      {view.groups.length === 0
        ? <Empty title="Nothing known at home yet" hint="Orders, and anything you say in the app's chat, show up here." object="grocery-bag" />
        : view.groups.map((g) => (
          <Section key={g.kind} title={g.kind}>
            <RowList rows={g.items} rowKey={(i) => i.ingredient_id} title={(i) => i.name} meta={(i) => sureLine(i, today)}
              onRowClick={(i) => setOpenId((id) => (id === i.ingredient_id ? null : i.ingredient_id))}
              expanded={openOf(g.items)} />
          </Section>
        ))}
    </Page>
  );
}
