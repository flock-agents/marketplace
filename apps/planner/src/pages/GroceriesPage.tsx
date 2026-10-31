import "./groceries.css";
import { useEffect, useState } from "react";
import { Button, Empty, ErrorCard, KitError, Page, Section, Skeleton, cx, kitFetch, label, useTable, useToast, useToday } from "../flock/ui";
import { CategoryFilter, type FilterOption } from "./CategoryFilter";
import { ManageGroceries } from "./ManageGroceries";
import { AddGroceryItem, type NewGroceryItem } from "./AddGroceryItem";
import { applyShow, draftKeyOf, groupBySlot, mergeItems, type ItemLine, type Range, type ShowFilter, lineKeyOf } from "./groceryGroups";
import { ActionBar } from "./ActionBar";
import { GroceryRow } from "./GroceryRow";
import { GroupHeading, type TriState } from "./GroupHeading";
import { OrderStatusLine } from "./OrderStatusLine";
import { UsualOrderTimes } from "./UsualOrderTimes";
import { CATEGORIES, CATEGORY_LABELS, addDays, serviceLabel, weekday, type Grocery } from "./shared";
import { mealShort, orderStatus, slotTitle, type CartV2, type GroceryV2, type MealV2 } from "./shopping";
import { dropFromDraft, letGo, orderWith, restoreToDraft } from "./shoppingApi";

/** The page's one filter: what to show, by status or by category. */
const SHOW_OPTIONS: FilterOption[] = [
  { id: "need", label: "To buy" }, { id: "in_cart", label: "In cart" }, { id: "all", label: "Everything" },
  ...CATEGORIES.map((c) => ({ id: `cat:${c}`, label: CATEGORY_LABELS[c] ?? c })),
];

/** "YYYY-MM-DDTHH:MM" now, in the viewer's own time zone, refreshed every minute so a deadline passing shows. */
function useNowAt(): string {
  const read = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [nowAt, setNowAt] = useState(read);
  useEffect(() => { const t = setInterval(() => setNowAt(read()), 60_000); return () => clearInterval(t); }, []);
  return nowAt;
}

/** Each open order's merged, pack-rounded line range by grocery row id (GET /api/shopping/slots, which also
 *  recomputes the plan first). `version` changes after every load so the tables are refetched behind it. */
type SlotsResponse = { slots: { lines: (Range & { row_ids: string[] })[] }[] };
function useLineRanges(): { rangeFor: (rowId: string) => Range | undefined; reload: () => void; version: number } {
  const [ranges, setRanges] = useState<Map<string, Range>>(new Map());
  const [version, setVersion] = useState(0);
  const reload = () => {
    void kitFetch<SlotsResponse>("shopping/slots").then((res) => {
      const next = new Map<string, Range>();
      for (const slot of res.slots) for (const l of slot.lines) for (const id of l.row_ids) next.set(id, { qty_min: l.qty_min, qty_max: l.qty_max, qty_unit: l.qty_unit });
      setRanges(next);
      setVersion((v) => v + 1);
    }).catch(() => {});
  };
  useEffect(reload, []);
  return { rangeFor: (id) => ranges.get(id), reload, version };
}

const triState = (ids: string[], selected: Set<string>): TriState => {
  if (!ids.length) return "none";
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? "none" : n === ids.length ? "all" : "some";
};

/** `focus`: grocery row ids to highlight, the first one opened (a meal's "Need …" chip links here). */
export function GroceriesPage({ focus = [] }: { focus?: string[] }) {
  const toast = useToast();
  const [managing, setManaging] = useState(false);
  const [show, setShow] = useState<ShowFilter>("need");
  const [showPast, setShowPast] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toggledCollapse, setToggledCollapse] = useState<Set<string>>(new Set());
  const now = useToday();
  const nowAt = useNowAt();
  const list = useTable<GroceryV2>("groceries", { limit: 500, sort: "created_at" });
  const carts = useTable<CartV2>("carts", { limit: 200, sort: "buy_at" });
  const meals = useTable<MealV2>("meals", { where: { "date[gte]": addDays(now, -7) }, limit: 500, sort: "date" });
  const lineRanges = useLineRanges();
  const focusSet = new Set(focus);
  const focusKey = focus.join(",");
  // Open the first focused line once its row has loaded (the page's own line key is "<id>" or the merged key).
  useEffect(() => {
    if (!focus.length || list.loading) return;
    const row = list.rows.find((r) => focusSet.has(r.id));
    if (row) setExpandedId(lineKeyOf(row));
  }, [focusKey, list.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (lineRanges.version) { void list.refetch(); void carts.refetch(); } }, [lineRanges.version]);

  if (list.error) return <Page title={label("title.groceries", "Shopping")}><ErrorCard title="Couldn't load the list" message={list.error} onRetry={list.refetch} /></Page>;
  if (list.loading && list.rows.length === 0) return <Page title={label("title.groceries", "Shopping")}><Skeleton variant="card" lines={6} /></Page>;

  const snoozed = (r: Grocery) => !!r.in_stock_until && r.in_stock_until > now;
  const openRows = list.rows.filter((r) => !snoozed(r) && (r.status ?? "pending") !== "ordered" && (r.status ?? "pending") !== "skipped");
  const left = new Set(openRows.map((r) => `${r.cart_id ?? ""}|${r.ingredient_id ?? r.item.trim().toLowerCase()}`)).size;

  const mealsById = new Map(meals.rows.map((m) => [m.id, m]));
  const mealLabel = (line: ItemLine<GroceryV2>) => {
    const labels = line.mealIds.flatMap((id) => { const m = mealsById.get(id); return m ? [mealShort(m, weekday)] : []; });
    return labels.length ? labels.join(", ") : null;
  };
  const shown = applyShow(list.rows, show, now);
  const groups = groupBySlot(shown, carts.rows, meals.rows, (m) => mealShort(m, weekday))
    .map((g) => ({ ...g, status: orderStatus(g.cart as CartV2 | null, nowAt) }));
  const openGroups = groups.filter((g) => !g.status.done);
  const pastGroups = groups.filter((g) => g.status.done);

  const recalc = () => { void kitFetch("timeline/recalc", { method: "POST" }).then(lineRanges.reload).catch(() => {}); };
  const addItem = async (v: NewGroceryItem) => {
    await list.create({ item: v.item, qty: v.qty, category: v.category, needed_by: v.needed_by, aisle: "Other", for_dish: null, source: "manual", status: "pending" });
    recalc();
  };

  // --- Selection -----------------------------------------------------------------------------------------------
  const toggleIds = (ids: string[]) => setSelected((prev) => {
    const allIn = ids.every((id) => prev.has(id));
    const next = new Set(prev);
    for (const id of ids) allIn ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  const say = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;

  // --- Writes (every bulk/per-item action shares these two) -----------------------------------------------------
  const reportFailures = (results: PromiseSettledResult<unknown>[]) => {
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast.show({ message: `${failed} ${say(failed, "item")} didn't save — try again`, tone: "danger" });
  };
  const bulkPatch = async (ids: string[], patch: Partial<Grocery>): Promise<string[]> => {
    const results = await Promise.allSettled(ids.map((id) =>
      kitFetch<{ row: Grocery; changeId?: string }>(`_data/groceries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    ));
    reportFailures(results);
    return results.flatMap((r) => (r.status === "fulfilled" && r.value.changeId ? [r.value.changeId] : []));
  };
  const bulkRemove = async (ids: string[]): Promise<string[]> => {
    const results = await Promise.allSettled(ids.map((id) =>
      kitFetch<{ ok: boolean; changeId?: string }>(`_data/groceries/${id}`, { method: "DELETE" }),
    ));
    reportFailures(results);
    return results.flatMap((r) => (r.status === "fulfilled" && r.value.changeId ? [r.value.changeId] : []));
  };
  const undoToast = (message: string, changeIds: string[]) => toast.show({
    message, tone: "success",
    action: changeIds.length ? { label: "Undo", onClick: () => {
      void Promise.all(changeIds.map((id) => kitFetch(`_data/_changes/${id}/undo`, { method: "POST" }))).catch(() => toast.show({ message: "Couldn't undo everything", tone: "danger" }));
    } } : undefined,
  });

  const refresh = lineRanges.reload;
  const failed = (e: unknown, fallback: string) => {
    const reason = e instanceof KitError ? (e.body?.message as string | undefined) : undefined;
    toast.show({ message: reason ?? fallback, tone: "danger" });
  };

  // --- Per-item actions (the inline panel under a tapped item) ---------------------------------------------------
  const markBoughtOne = async (ids: string[]) => {
    setExpandedId(null);
    undoToast("Marked bought", await bulkPatch(ids, { status: "ordered" }));
  };
  const inStockOne = async (ids: string[], date: string) => {
    setExpandedId(null);
    undoToast("Marked in stock", await bulkPatch(ids, { in_stock_until: date }));
    recalc();
  };
  // On a draft nobody has said yes to, a skip drops the line from that draft through the app (a logged choice).
  const skipOne = async (line: ItemLine<GroceryV2>, cart: CartV2 | null) => {
    setExpandedId(null);
    if (cart?.status !== "draft" || cart.yes_at) { undoToast("Skipped", await bulkPatch(line.ids, { status: "skipped" })); recalc(); return; }
    const keys = [draftKeyOf(line.row)];
    try {
      await dropFromDraft(cart.id, keys);
      toast.show({ message: "Skipped", tone: "success", action: { label: "Undo", onClick: () => { void restoreToDraft(cart.id, keys).then(refresh).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } });
      refresh();
    } catch (e) { failed(e, "Couldn't skip that"); }
  };

  // --- Bulk actions (the action bar, for whatever is selected) ---------------------------------------------------
  const activeRows = shown.filter((r) => selected.has(r.id));
  const activeIds = activeRows.map((r) => r.id);
  // The shared category across every selected row, for the "already have it" quick picks below — null (the
  // generic default) once the selection spans more than one, same as a row with no category of its own.
  const activeCategory = activeRows.length ? activeRows.map((r) => r.category).reduce((a, b) => (a === b ? a : null)) : null;

  const addToCart = async () => { const ids = activeIds; clearSelection(); undoToast(`Added ${ids.length} ${say(ids.length, "item")} to the cart`, await bulkPatch(ids, { status: "confirmed" })); };
  const markBought = async () => { const ids = activeIds; clearSelection(); undoToast(`Marked ${ids.length} ${say(ids.length, "item")} bought`, await bulkPatch(ids, { status: "ordered" })); };
  const skipSelected = async () => { const ids = activeIds; clearSelection(); undoToast(`Skipped ${ids.length} ${say(ids.length, "item")}`, await bulkPatch(ids, { status: "skipped" })); recalc(); };
  const removeSelected = async () => { const ids = activeIds; clearSelection(); undoToast(`Removed ${ids.length} ${say(ids.length, "item")}`, await bulkRemove(ids)); };
  const inStockSelected = async (date: string) => { const ids = activeIds; clearSelection(); undoToast(`Marked ${ids.length} ${say(ids.length, "item")} in stock`, await bulkPatch(ids, { in_stock_until: date })); recalc(); };

  // --- The next draft: the owner's yes ("Order with …") or "Let it go" --------------------------------------------
  const orderNext = (cartId: string) => async (service: string) => {
    try { await orderWith(cartId, service); toast.show({ message: `Sent your yes — ordering on ${serviceLabel(service)}`, tone: "success" }); refresh(); }
    catch (e) { failed(e, "Couldn't send your yes right now"); }
  };
  const letGoNext = (cartId: string) => async () => {
    try { await letGo(cartId); toast.show({ message: "Let go — its items move to the next order", tone: "success" }); refresh(); }
    catch (e) { failed(e, "Couldn't let that order go"); }
  };

  // The next draft (the soonest open one) carries the order actions; past orders start collapsed, open ones open.
  const nextDraftKey = openGroups.find((g) => (g.cart as CartV2 | null)?.status === "draft")?.key;
  const collapsed = (g: { key: string; status: { done: boolean } }) => (toggledCollapse.has(g.key) ? !g.status.done : g.status.done);
  const toggleCollapse = (key: string) => setToggledCollapse((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  type Group = (typeof groups)[number];
  // The order after this one, for "its items move to the next order (…)".
  const orderAfter = (g: Group): string | null => {
    const at = (x: Group) => (x.cart as CartV2 | null)?.order_at ?? x.cart?.buy_at ?? null;
    const mine = at(g);
    return openGroups.map(at).filter((t): t is string => !!t && !!mine && t > mine).sort()[0] ?? null;
  };
  const renderGroup = (g: Group) => {
    const isCollapsed = collapsed(g);
    const ids = g.rows.map((r) => r.id);
    const lines = mergeItems(g.rows, lineRanges.rangeFor);
    return (
      <Section key={g.key} emphasis={g.status.done ? "subtle" : "plain"}>
        <GroupHeading title={`${slotTitle(g.cart, g.covers, now)} · ${lines.length}`} state={triState(ids, selected)}
          onToggleAll={() => toggleIds(ids)} collapsible onToggleCollapse={() => toggleCollapse(g.key)} collapsed={isCollapsed} />
        <OrderStatusLine cart={g.cart as CartV2 | null} status={g.status}
          onOrder={g.key === nextDraftKey ? orderNext(g.key) : undefined} onLetGo={g.key === nextDraftKey ? letGoNext(g.key) : undefined}
          itemCount={lines.length} nextOrderAt={orderAfter(g)} today={now} />
        {isCollapsed ? null : lines.map((line) => (
          <GroceryRow key={line.key} row={line.rows.length > 1 ? { ...line.row, for_dish: null } : line.row} now={now} mealLabel={mealLabel(line)}
            selected={line.ids.every((id) => selected.has(id))} onToggleSelect={() => toggleIds(line.ids)}
            expanded={expandedId === line.key} onToggleExpand={() => setExpandedId((k) => (k === line.key ? null : line.key))}
            focused={line.ids.some((id) => focusSet.has(id))}
            onMarkBought={() => markBoughtOne(line.ids)} onInStock={(date) => inStockOne(line.ids, date)} onSkip={() => skipOne(line, g.cart as CartV2 | null)} />
        ))}
      </Section>
    );
  };

  return (
    <Page title={label("title.groceries", "Shopping")} subtitle={left === 0 && list.rows.length ? "Everything is in the bag" : `${left} still to buy`}
      actions={list.rows.length ? (
        <Button variant="soft" icon={managing ? "check" : "pencil"} onClick={() => { setManaging(!managing); clearSelection(); }}>{managing ? "Done editing" : "Edit items"}</Button>
      ) : undefined}>
      {managing ? null : <AddGroceryItem onAdd={addItem} />}
      {list.rows.length === 0 ? <Empty title="Nothing to buy" hint="Add an item above, or ask the assistant to make the list from the week." object="grocery-bag" />
        : managing ? <ManageGroceries rows={list.rows} update={list.update} remove={list.remove} /> : (
        <>
          <div className="pl-groc-toolbar">
            <CategoryFilter label="Show" options={SHOW_OPTIONS} value={show} onChange={(v) => setShow(v as ShowFilter)} />
          </div>
          <div className={cx(selected.size > 0 && "pl-groc-list")}>
            {groups.length === 0 ? <Empty title="Nothing here" hint="Nothing matches this filter right now." object="grocery-bag" /> : openGroups.map(renderGroup)}
            {pastGroups.length ? (
              <>
                <button type="button" className="pl-past" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
                  {showPast ? "Hide" : "Show"} past orders · {pastGroups.length}
                </button>
                {showPast ? pastGroups.map(renderGroup) : null}
              </>
            ) : null}
            <UsualOrderTimes onChanged={refresh} />
          </div>
        </>
      )}
      {managing ? null : (
        <ActionBar count={activeIds.length} now={now} category={activeCategory}
          onAddToCart={addToCart} onInStock={inStockSelected}
          onMarkBought={markBought} onSkip={skipSelected} onRemove={removeSelected} onClear={clearSelection} />
      )}
    </Page>
  );
}
