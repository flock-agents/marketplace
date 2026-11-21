import { useState, type ReactNode } from "react";
import { Button, Detail, Field, Form, Heading, InlinePanel, Row, Section, Skeleton, Stack, useApp, useTable, useToast, type FormProps } from "../flock/ui";
import { APP_NAMES, SHOP_APPS, type GroceryApp } from "../../server/db/constants";
import { RowsEditor } from "./RowsEditor";
import { agentName, howWeOrderText } from "./format";
import { send, useLive, why, type Family } from "./shared";

const FALLBACK_LABELS: Record<string, string> = { none: "None", ...APP_NAMES };
const APPS_FIELDS: FormProps["fields"] = [
  { type: "select", name: "main", label: "Main app", required: true, options: [...SHOP_APPS], optionLabels: APP_NAMES },
  { type: "select", name: "fallback", label: "When something isn't there", options: ["none", ...SHOP_APPS], optionLabels: FALLBACK_LABELS },
  // The tick list shows its options as they are, so the apps are listed by name and turned back into ids on save (APP_BY_NAME).
  { type: "multi", name: "connected", label: "Signed in", options: SHOP_APPS.map((a) => APP_NAMES[a]) },
];
const APP_BY_NAME: Record<string, GroceryApp> = Object.fromEntries(SHOP_APPS.map((a) => [APP_NAMES[a], a]));
const appNames = (apps: readonly GroceryApp[]) => apps.map((a) => APP_NAMES[a] ?? a).join(", ");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** An item delivered outside the apps, as the kit's data route gives it. */
type SubscriptionRow = { id: string; name: string; subscription: string | null };

/** How the house orders, at the top of the Shopping page: the shopping apps, what comes on a subscription (left out of every
 *  cart), and whether an order may go without asking. Closed it is one line, so the cart stays the page; Edit opens the three
 *  parts, each edited in place through the same routes (and the same checks) as the agent. Anyone who orders sees it, not
 *  only the owner. */
export function HowWeOrder() {
  const family = useLive<Family>("family", ["house", "_settings"]);
  const items = useTable<SubscriptionRow>("items", { sort: "name", limit: 500 });
  const agent = agentName(useApp().display);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const title = "How we order";
  if (family.error && !family.data) {
    return (
      <Section title={title} actions={<Button size="sm" variant="soft" icon="refresh-cw" onClick={() => void family.refetch()}>Retry</Button>}>
        <p className="pl-quiet">{`Couldn't load how you order: ${family.error}`}</p>
      </Section>
    );
  }
  if (!family.data) return <Section title={title}><Skeleton lines={1} /></Section>;
  const { shopping } = family.data;
  const subscriptions = items.rows.filter((i) => i.subscription);

  const close = () => setEditing(null);
  const toggle = (key: string) => setEditing(editing === key ? null : key);
  const edit = (key: string, disabled = false) => <Button size="sm" variant="ghost" icon="pencil" disabled={disabled} onClick={() => toggle(key)}>Edit</Button>;
  /** An editor opened in place, under the part it edits. */
  const panel = (key: string, heading: string, content: ReactNode) => editing === key ? (
    <InlinePanel label={heading} onClose={close} className="pl-panel">
      <Stack gap="md"><Heading level={3}>{heading}</Heading>{content}</Stack>
    </InlinePanel>
  ) : null;
  const part = (heading: string, action: ReactNode) => <Row justify="between"><Heading level={3}>{heading}</Heading>{action}</Row>;
  const setOrderWithoutAsking = async (on: boolean) => {
    try {
      await send("_app/settings", { order_without_asking: on }, "PATCH"); void family.refetch();
      toast.show({ message: on ? `${agent} now orders without asking` : "Nothing is ordered until you reply or tap Order", tone: "success" });
    } catch (e) { toast.show({ message: `Couldn't change it: ${why(e)}`, tone: "danger" }); }
  };
  /** The subscriptions as edited: each one listed is on; one taken off the list is an item like any other again. */
  const saveSubscriptions = async (rows: Record<string, unknown>[]) => {
    const kept = rows.map((r) => ({ item: String(r.item ?? "").trim(), source: String(r.source ?? "").trim() })).filter((r) => r.item || r.source);
    const missing = kept.find((r) => !r.item || !r.source);
    if (missing) throw new Error(missing.item ? `Say who delivers ${missing.item}.` : "Say which item comes from each one.");
    try {
      for (const s of subscriptions) if (!kept.some((k) => same(k.item, s.name))) await send("items/subscription", { item: s.name, active: false });
      for (const k of kept) if (!subscriptions.some((s) => same(s.name, k.item) && s.subscription === k.source)) await send("items/subscription", { item: k.item, source: k.source, active: true });
      close();
    } finally { void items.refetch(); }
  };

  const openClose = (
    <Button size="sm" variant="soft" icon={open ? "check" : "pencil"} onClick={() => { setOpen(!open); close(); }}>{open ? "Done" : "Edit"}</Button>
  );
  if (!open) {
    return <Section title={title} actions={openClose}><p className="pl-quiet">{howWeOrderText(shopping, subscriptions)}</p></Section>;
  }
  return (
    <Section title={title} actions={openClose}>
      <Stack gap="md">
        <Stack gap="sm">
          {part("Shopping apps", edit("apps"))}
          <Detail fields={[
            { label: "Main app", value: APP_NAMES[shopping.main] ?? shopping.main },
            { label: "When something isn't there", value: shopping.fallback ? APP_NAMES[shopping.fallback] : "None" },
            { label: "Signed in", value: shopping.connected.length ? appNames(shopping.connected) : "None yet" },
          ]} />
          {panel("apps", "Shopping apps", (
            <Form fields={APPS_FIELDS} onCancel={close}
              initial={{ main: shopping.main, fallback: shopping.fallback ?? "none", connected: shopping.connected.map((a) => APP_NAMES[a] ?? a) }}
              onSubmit={async (v) => {
                await send("family/shopping-apps", { main: v.main, fallback: v.fallback && v.fallback !== "none" ? v.fallback : null,
                  connected: ((v.connected as string[] | null) ?? []).map((n) => APP_BY_NAME[n] ?? n) });
                close(); void family.refetch();
              }} />
          ))}
        </Stack>

        <Stack gap="sm">
          {part("Subscriptions", edit("subscriptions", items.loading))}
          <p className="pl-quiet">Items delivered outside the apps, like milk from a milkman. They are never put in a cart or asked about.</p>
          {subscriptions.length
            ? <Detail fields={subscriptions.map((s) => ({ label: s.name, value: `from ${s.subscription}` }))} />
            : <p className="pl-quiet">None yet.</p>}
          {panel("subscriptions", "Subscriptions", (
            <RowsEditor addLabel="Add a subscription" onCancel={close}
              columns={[
                { name: "item", label: "Item", type: "text", placeholder: "Milk" },
                { name: "source", label: "Who delivers it", type: "text", placeholder: "Country Delight, the milkman" },
              ]}
              initial={subscriptions.map((s) => ({ item: s.name, source: s.subscription ?? "" }))}
              onSave={saveSubscriptions} />
          ))}
        </Stack>

        <Stack gap="sm">
          <Field type="checkbox" name="order_without_asking" label="Order without asking" value={shopping.order_without_asking} onChange={(v) => void setOrderWithoutAsking(v === true)} />
          <p className="pl-quiet">{shopping.order_without_asking ? `${agent} orders what is in your carts without asking first.` : "Off: nothing is ordered until you reply or tap Order."}</p>
        </Stack>
      </Stack>
    </Section>
  );
}
