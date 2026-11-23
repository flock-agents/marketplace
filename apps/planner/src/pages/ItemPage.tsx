import { useState } from "react";
import { Button, Callout, Card, Detail, ErrorCard, Form, Heading, InlinePanel, Page, Row, RowList, Section, Skeleton, Stack, Value, useChat, useToast, type FormProps } from "../flock/ui";
import { ESTIMATE, SUBSCRIPTION_UNNAMED } from "../../server/db/constants";
import { eventRows, itemCallout, itemSubtitle, patternFields, patternSource, TAG_TONES } from "./format";
import { send, useLive, why, type ItemView } from "./shared";

const SUBSCRIPTION_FIELDS: FormProps["fields"] = [
  { type: "text", name: "source", label: "From (optional)", placeholder: "the milkman, Country Delight" },
];

/** One pantry item: whether it is on a subscription, low or snoozed, her pattern for it, and the purchases and answers it was
 *  learned from. It never names the app the item is bought on. Snooze, "Don't ask about this" and "Comes on subscription" (with
 *  who delivers it, if she says) save here; a new product is asked in the chat. A subscription is this item's setting: on, the
 *  item is never put in a cart or asked about. */
export function ItemPage({ id, onBack }: { id: string; onBack: () => void }) {
  const view = useLive<ItemView>(`items/${id}`, ["items", "item_events", "orders", "order_lines"]);
  const chat = useChat();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const back = <Button size="sm" variant="ghost" icon="arrow-left" onClick={onBack}>Pantry</Button>;
  if (view.error && !view.data) return <Page title="Pantry" actions={back}><ErrorCard title="Couldn't load this item" message={view.error} onRetry={() => void view.refetch()} /></Page>;
  if (!view.data) return <Page actions={back}><Skeleton variant="card" lines={6} /></Page>;
  const { item: i, events } = view.data;
  const callout = itemCallout(i);
  const counted = Math.min(events.filter((e) => e.tag === "counted" || e.tag === "early buy").length, ESTIMATE.cycles);
  const save = async (what: string, body: object, done: string, path = "items") => {
    setBusy(what);
    try { await send(path, { item: i.name, ...body }); toast.show({ message: done, tone: "success" }); void view.refetch(); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
    finally { setBusy(null); }
  };
  /** On, with who delivers it (nobody named is kept as SUBSCRIPTION_UNNAMED): a refusal is thrown to the form. */
  const subscribe = async (v: Record<string, unknown>) => {
    const source = String(v.source ?? "").trim() || SUBSCRIPTION_UNNAMED;
    await send("items/subscription", { item: i.name, source, active: true });
    setSubscribing(false); void view.refetch();
    toast.show({ message: `${i.name} comes on subscription: it won't be put in a cart or asked about`, tone: "success" });
  };
  const subscribed = !!i.subscription;
  const named = subscribed && i.subscription !== SUBSCRIPTION_UNNAMED ? i.subscription : "";
  return (
    <Page title={i.name} subtitle={itemSubtitle(i) || undefined}
      actions={<>{back}{subscribed ? null : <Button size="sm" variant="soft" icon="bell-off" loading={busy === "snooze"} onClick={() => void save("snooze", { snooze_days: 7 }, `${i.name} is snoozed for a week`)}>Snooze</Button>}</>}>
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
        {chat.available && !subscribed ? <Button size="sm" variant="soft" onClick={() => chat.openChat({ message: `Change the product for ${i.name}: ` })}>Change product</Button> : null}
        {subscribed ? (
          <>
            <Button size="sm" variant="soft" icon="pencil" onClick={() => setSubscribing(!subscribing)}>Who delivers it</Button>
            <Button size="sm" variant="ghost" loading={busy === "unsubscribe"}
              onClick={() => void save("unsubscribe", { active: false }, `${i.name} is bought on the apps again`, "items/subscription")}>Not on subscription</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon="repeat" onClick={() => setSubscribing(!subscribing)}>Comes on subscription</Button>
            <Button size="sm" variant="ghost" loading={busy === "dont_ask"} onClick={() => void save("dont_ask", { dont_ask: true }, `You won't be asked about ${i.name} again`)}>Don't ask about this</Button>
          </>
        )}
      </Row>
      {subscribing ? (
        <InlinePanel label="Comes on subscription" onClose={() => setSubscribing(false)} className="pl-panel">
          <Stack gap="md">
            <Heading level={3}>Comes on subscription</Heading>
            <p className="pl-quiet">{`Delivered outside the apps, like milk from a milkman: ${i.name} is never put in a cart or asked about.`}</p>
            <Form fields={SUBSCRIPTION_FIELDS} initial={{ source: named }} submitLabel={subscribed ? "Save" : "Turn on"}
              onCancel={() => setSubscribing(false)} onSubmit={subscribe} />
          </Stack>
        </InlinePanel>
      ) : null}
    </Page>
  );
}
