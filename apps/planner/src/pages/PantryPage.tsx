import { useState } from "react";
import { Empty, ErrorCard, Page, RowList, Skeleton, Tabs, Value, label } from "../flock/ui";
import { PANTRY_FILTER, pantryTabs, TAG_TONES } from "./format";
import { ItemPage } from "./ItemPage";
import { useLive, type PantryView } from "./shared";

const TABLES = ["items", "item_events", "orders", "order_lines"];

/** The Pantry: every item the family buys (not the subscribed ones), with its cycle ("500 ml every day", "30 pc about once a
 *  week"; the amount usually bought until a cycle is known) and whether it is in stock, low or snoozed. The only control is the status filter. An item opens its page in place. */
export function PantryPage() {
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const pantry = useLive<PantryView>("pantry", TABLES);
  if (openId) return <ItemPage id={openId} onBack={() => setOpenId(null)} />;
  const want = PANTRY_FILTER[tab] ?? null;
  return (
    <Page title={label("title.pantry", "Pantry")}>
      {pantry.error && !pantry.data ? <ErrorCard title="Couldn't load the pantry" message={pantry.error} onRetry={() => void pantry.refetch()} />
        : !pantry.data ? <Skeleton variant="row" lines={6} />
        : (
          <>
            <Tabs tabs={pantryTabs(pantry.data.counts)} value={tab} onChange={setTab} />
            <RowList rows={pantry.data.rows.filter((r) => !want || r.status === want)} rowKey={(r) => r.id}
              title={(r) => r.name} meta={(r) => r.cycle ?? r.quantity} trailing={(r) => <Value kind="select" value={r.status} tones={TAG_TONES} />}
              onRowClick={(r) => setOpenId(r.id)}
              empty={pantry.data.counts.all
                ? <p className="pl-quiet">Nothing here right now.</p>
                : <Empty title="Nothing in the pantry yet" hint="Items show here once your order history is read, or after your first order." object="grocery-bag" />} />
          </>
        )}
    </Page>
  );
}
