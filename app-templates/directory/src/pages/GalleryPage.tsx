import { useMemo, useState } from "react";
import { Button, Card, Empty, Callout, FilterPill, Form, InlinePanel, Gallery, Page, Search, Skeleton, Value, useTable, label } from "../flock/ui";
import { fieldsFor, kindsIn, matches, objectFor, type Entry } from "./shared";

export function GalleryPage({ onOpen }: { onOpen: (row: { id: string; name: string }) => void }) {
  const [kind, setKind] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  // Search reads the name, the kind and the notes, so the filtering happens here, and so does the kind filter: the kinds offered
  // are the suggestions plus whatever the entries use, so all of them are loaded.
  const list = useTable<Entry>("entries", { sort: "name", limit: 500 });
  const kinds = useMemo(() => kindsIn(list.rows), [list.rows]);
  const shown = useMemo(() => list.rows.filter((e) => (!kind || e.kind === kind) && matches(e, q)), [list.rows, q, kind]);
  const add = async (values: Record<string, any>) => { await list.create(values as Partial<Entry>); setAdding(false); };
  return (
    <Page title={label("title.gallery", "Directory")} subtitle={`${shown.length}${list.hasMore ? "+" : ""} ${shown.length === 1 && !list.hasMore ? "entry" : "entries"}`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New entry" onClose={() => setAdding(false)}>
          <Card title="New entry">
            <Form fields={[...fieldsFor(kinds)]} initial={{ kind: "Other" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
          </Card>
        </InlinePanel>
      ) : null}
      <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Search value={q} onChange={setQ} placeholder="Search" />
        <FilterPill label="Kind" options={kinds} value={kind} onChange={setKind} />
      </div>
      {list.loading && !list.rows.length ? <Skeleton variant="card" lines={4} />
        : list.error ? <Callout tone="danger" title="Couldn't load the directory">{list.error}</Callout>
        : shown.length === 0 ? <Empty title={q || kind ? "No matches" : "Nothing here yet"} hint={q || kind ? "Nothing matches. Clear the search or the filter." : "Add the first entry, or ask the assistant to."} object="phone" action={<Button onClick={() => setAdding(true)}>Add an entry</Button>} />
        : <>
            {q && list.hasMore ? <Callout tone="info" title={`Searching the first ${list.rows.length}`}>Load more to search all of them.</Callout> : null}
            <Gallery
              rows={shown} image={(e) => e.image} object={(e) => objectFor(e.kind)} title={(e) => e.name} onClick={(e) => onOpen(e)}
              hasMore={list.hasMore} onLoadMore={() => void list.loadMore()} loading={list.loading}
              meta={(e) => <Value kind="select" value={e.kind} tones={{ [e.kind]: "accent" }} />}
            />
          </>}
    </Page>
  );
}
