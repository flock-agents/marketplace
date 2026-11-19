import { useEffect, useMemo, useRef, useState } from "react";
import { Callout, Empty, ErrorCard, ItemPicker, Section, Skeleton, Stack, useApp, useChat, useToast } from "../flock/ui";
import { addDays, todayStr } from "../../server/dates";
import { agentName, cartNote, cartTitle, debouncePicks, orderLabel, outsideText, pickerItems, PICKS_DEBOUNCE_MS, type Pick } from "./format";
import { send, statusOf, useLive, type CartView, type Shopping } from "./shared";

type Live<T> = { data: T | null; error: string | null; refetch: () => Promise<void> };
/** What a burst of taps on one app's picker sends: the picks, and the lines the picker showed (a line added since is not hers
 *  to have zeroed). */
type Sent = { picks: Pick[]; seen: string[] };

/** The lines a picker was made from: a new picker when the server adds or takes off a line, not when a qty changes, so her
 *  own tap is never undone by its echo. */
const lineSet = (c: CartView): string => `${c.order_id}:${c.lines.map((l) => l.id).sort().join(",")}`;

/** The Cart tab: one ItemPicker and one Order button per app. Her taps are saved once they stop (the server then copies the
 *  cart to the app); Order saves what is waiting, moves the cart to ordering and asks the agent in the chat to check out.
 *  Something new is added through the chat, not here. */
export function CartPanel({ carts }: { carts: Live<{ carts: CartView[] }> }) {
  const app = useApp();
  const agent = agentName(app.display);
  const chat = useChat();
  const toast = useToast();
  const family = useLive<{ shopping: Shopping }>("family", ["_settings", "house"]);
  const recent = useLive<{ orders: CartView[] }>(`orders?from=${addDays(todayStr(), -7)}`, ["orders"]);
  const [already, setAlready] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Her qty per line since the page opened, so a picker made again (a line was added) starts from her taps, not an older read.
  const mine = useRef<Record<string, number>>({});
  const latest = useRef({ carts, toast });
  latest.current = { carts, toast };

  const picks = useMemo(() => debouncePicks<Promise<void>, Sent>((shop, sent) =>
    send(`carts/${shop}/picks`, sent).then(() => {
      // Saved: the cart now says what she picked.
      for (const id of sent.seen) if (mine.current[id] === (sent.picks.find((p) => p.line_id === id)?.qty ?? 0)) delete mine.current[id];
    }, (e) => {
      if (statusOf(e) !== 409) latest.current.toast.show({ message: `Couldn't save your cart: ${e.message}`, tone: "danger" });
      void latest.current.carts.refetch();
    }), PICKS_DEBOUNCE_MS), []);

  // Opening the page reads each app's own cart again (prices, stock, free delivery); leaving it saves taps still waiting.
  useEffect(() => { void send("carts/refresh").catch(() => undefined); return () => picks.flushAll(); }, [picks]);

  if (carts.error && !carts.data) return <ErrorCard title="Couldn't load your cart" message={carts.error} onRetry={() => void carts.refetch()} />;
  if (!carts.data) return <Skeleton variant="card" lines={5} />;
  const list = carts.data.carts;
  const shopping = family.data?.shopping ?? null;
  const unpaid = (recent.data?.orders ?? []).filter((o) => o.status === "placed");
  const ordering = (shop: string) => list.some((c) => c.app === shop && c.status === "ordering");

  const changed = (c: CartView, picked: { id: string; qty: number }[]) => {
    const seen = c.lines.map((l) => l.id);
    for (const id of seen) mine.current[id] = picked.find((p) => p.id === id)?.qty ?? 0;
    picks.change(c.app, { picks: picked.map((p) => ({ line_id: p.id, qty: p.qty })), seen });
  };
  const order = async (c: CartView, picked: { id: string; qty: number }[]) => {
    setBusy(c.app);
    try {
      await picks.flush(c.app);
      const res = await send<{ already?: true }>(`carts/${c.app}/order`, { picks: picked.map((p) => ({ line_id: p.id, qty: p.qty })), seen: c.lines.map((l) => l.id) });
      if (res.already) setAlready((a) => ({ ...a, [c.app]: true }));
      else chat.openChat({ message: `Order my ${c.app_name} cart`, send: true });
    } catch (e) {
      toast.show({ message: statusOf(e) === 409 ? `Your ${c.app_name} cart changed. Have a look and order again.` : `Couldn't order: ${(e as Error).message}`, tone: "danger" });
    } finally { setBusy(null); void carts.refetch(); }
  };

  return (
    <Stack gap="md">
      <Callout tone="info" icon="clock">Nothing is ordered until you tap Order or tell {agent}.</Callout>
      {unpaid.map((o) => (
        <Callout key={o.order_id} tone="warning" icon="credit-card" title={`Your ${o.app_name} order`}>{cartNote(o)}</Callout>
      ))}
      {list.length ? list.map((c) => {
        const open = c.status === "open";
        const note = cartNote(c, { already: open && already[c.app] && ordering(c.app), chat: chat.available, agent });
        const outside = outsideText(c.outside_lines);
        const items = pickerItems(open ? c.lines : c.lines.filter((l) => (l.qty ?? 0) > 0)).map((it) => ({ ...it, qty: mine.current[it.id] ?? it.qty }));
        return (
          <Section key={c.order_id} title={cartTitle(c, shopping)}>
            <Stack gap="sm">
              <ItemPicker key={lineSet(c)} items={items} submitLabel={orderLabel(c)} disabled={!open || !chat.available || busy === c.app}
                onChange={open ? (p) => changed(c, p) : undefined} onSubmit={(p) => void order(c, p)} />
              {outside ? <p className="pl-quiet">{outside}</p> : null}
              {note ? <Callout tone="muted" icon={note.endsWith("free delivery") ? "truck" : "info"}>{note}</Callout> : null}
            </Stack>
          </Section>
        );
      }) : unpaid.length ? null : <Empty title="Your cart is empty" hint={`Tell ${agent} what you need, here in the chat or on WhatsApp.`} object="grocery-bag" />}
    </Stack>
  );
}
