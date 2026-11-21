import { useState } from "react";
import { Empty, ErrorCard, Page, RowList, Skeleton, Tabs, Value, label } from "../flock/ui";
import { PANTRY_FILTER, pantryTabs, subscriptionTag, TAG_TONES } from "./format";
import { ItemPage } from "./ItemPage";
import { Thumb } from "./Thumb";
import { useLive, type PantryView } from "./shared";

const TABLES = ["items", "item_events", "orders", "order_lines", "products"];

/** The Pantry: every item the family buys, with its cycle ("500 ml every day", "30 pc about once a
 *  week"; the amount usually bought until a cycle is known) and whether it is in stock, low or snoozed, with the shopping app's
 *  picture of it (its first letter when there is none; no pictures at all until one item has one). An item delivered outside the
 *  apps shows "Subscription · the milkman" instead of a status. The only control is the status filter. An item opens its page in place. */
export function PantryPage() {
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const pantry = useLive<PantryView>("pantry", TABLES);
  if (openId) return <ItemPage id={openId} onBack={() => setOpenId(null)} />;
  const want = PANTRY_FILTER[tab] ?? null;
  const pictures = !!pantry.data?.rows.some((r) => r.image);
  return (
    <Page title={label("title.pantry", "Pantry")}>
      {pantry.error && !pantry.data ? <ErrorCard title="Couldn't load the pantry" message={pantry.error} onRetry={() => void pantry.refetch()} />
        : !pantry.data ? <Skeleton variant="row" lines={6} />
        : (
          <>
            <Tabs tabs={pantryTabs(pantry.data.counts)} value={tab} onChange={setTab} />
            <RowList rows={pantry.data.rows.filter((r) => !want || r.status === want)} rowKey={(r) => r.id}
              leading={pictures ? (r) => <Thumb src={r.image} name={r.name} /> : undefined}
              title={(r) => r.name} meta={(r) => r.cycle ?? r.quantity} trailing={(r) => <Value kind="select" value={r.status} tones={TAG_TONES} labels={{ Subscription: subscriptionTag(r.subscription) }} />}
              onRowClick={(r) => setOpenId(r.id)}
              empty={pantry.data.counts.all
                ? <p className="pl-quiet">Nothing here right now.</p>
                : <Empty title="Nothing in the pantry yet" hint="Items show here once your order history is read, or after your first order." object="grocery-bag" />} />
          </>
        )}
    </Page>
  );
}
