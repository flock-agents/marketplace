import { useState } from "react";
import { Button, Callout, Card, Detail, ErrorCard, Page, Row, RowList, Section, Skeleton, Value, useChat, useToast } from "../flock/ui";
import { ESTIMATE } from "../../server/db/constants";
import { eventRows, itemCallout, itemSubtitle, patternFields, patternSource, TAG_TONES } from "./format";
import { send, useLive, why, type ItemView } from "./shared";

/** One pantry item: whether it is low or snoozed, her pattern for it, and the purchases and answers it was learned from. It
 *  never names the app the item is bought on. Snooze and "Don't ask about this" save here; a new product is asked in the chat. */
export function ItemPage({ id, onBack }: { id: string; onBack: () => void }) {
  const view = useLive<ItemView>(`items/${id}`, ["items", "item_events", "orders", "order_lines"]);
  const chat = useChat();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const back = <Button size="sm" variant="ghost" icon="arrow-left" onClick={onBack}>Pantry</Button>;
  if (view.error && !view.data) return <Page title="Pantry" actions={back}><ErrorCard title="Couldn't load this item" message={view.error} onRetry={() => void view.refetch()} /></Page>;
  if (!view.data) return <Page actions={back}><Skeleton variant="card" lines={6} /></Page>;
  const { item: i, events } = view.data;
  const callout = itemCallout(i);
  const counted = Math.min(events.filter((e) => e.tag === "counted" || e.tag === "early buy").length, ESTIMATE.cycles);
  const save = async (what: string, body: object, done: string) => {
    setBusy(what);
    try { await send("items", { item: i.name, ...body }); toast.show({ message: done, tone: "success" }); void view.refetch(); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
    finally { setBusy(null); }
  };
  return (
    <Page title={i.name} subtitle={itemSubtitle(i) || undefined}
      actions={<>{back}<Button size="sm" variant="soft" icon="bell-off" loading={busy === "snooze"} onClick={() => void save("snooze", { snooze_days: 7 }, `${i.name} is snoozed for a week`)}>Snooze</Button></>}>
      {callout ? <Callout tone={callout.tone} icon={callout.icon} title={callout.title}>{callout.body}</Callout> : null}
      <Card title="Her pattern" meta={patternSource(i, counted)}>
        <Detail fields={patternFields(i)} />
      </Card>
      <Section title="What it learned from">
        <RowList rows={eventRows(events)} rowKey={(r) => r.id} title={(r) => r.what} meta={(r) => r.when}
          trailing={(r) => (r.tag ? <Value kind="select" value={r.tag} tones={TAG_TONES} /> : null)}
          empty={<p className="pl-quiet">No purchases or answers yet.</p>} />
      </Section>
      <Row>
        {chat.available ? <Button size="sm" variant="soft" onClick={() => chat.openChat({ message: `Change the product for ${i.name}: ` })}>Change product</Button> : null}
        <Button size="sm" variant="ghost" loading={busy === "dont_ask"} onClick={() => void save("dont_ask", { dont_ask: true }, `You won't be asked about ${i.name} again`)}>Don't ask about this</Button>
      </Row>
    </Page>
  );
}
