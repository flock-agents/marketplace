import { Checklist, Empty, ErrorCard, Page, Section, Skeleton, useTable, label, isSample } from "../flock/ui";
import { PEOPLE, type PackItem } from "./shared";

const rank = (who: string) => { const i = PEOPLE.indexOf(who); return i < 0 ? PEOPLE.length : i; };   // a traveller not in the list goes last

export function PackingPage() {
  const list = useTable<PackItem>("packing", { sort: "who", limit: 200 });
  const left = list.rows.filter((i) => !i.packed).length;
  return (
    <Page title={label("title.packing", "Packing")} subtitle={list.rows.length ? `${left} left to pack` : undefined}>
      {list.error ? <ErrorCard title="Couldn't load the list" message={list.error} onRetry={list.refetch} />
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={5} />
        : (
          <Section>
            {list.rows.length ? null : <Empty title="Nothing to pack yet" hint="Add the first item below." object="plane" />}
            <Checklist
              grouped showProgress
              items={[...list.rows].sort((a, b) => rank(a.who) - rank(b.who)).map((i) => ({ id: i.id, label: i.item, done: !!i.packed, group: i.who, sample: isSample(i) }))}
              onToggle={(id, done) => { void list.update(id, { packed: done }).catch(() => {}); }}
              onAdd={(label, group) => { void list.create({ item: label, who: group ?? "Shared", packed: false }).catch(() => {}); }}
            />
          </Section>
        )}
    </Page>
  );
}
