import { useState } from "react";
import { Button, Callout, Empty, FilterPill, Page, Search, StatStrip, Table, label } from "../flock/ui";
import { formatINR } from "../flock/ui";
import { InvoicePage } from "./InvoicePage";
import { SampleBusinessNotice } from "./SampleBusinessNotice";
import { STATUSES, STATUS_LABEL, STATUS_LABEL_TONES, cap, localToday, longDate, one, useApi, useInvoiceList, type InvoiceRow, type Selected, type Summary } from "./shared";

const exact = (n: number) => formatINR(n, { exact: true });
const LABEL_TO_STATUS = Object.fromEntries(STATUSES.map((s) => [STATUS_LABEL[s], s]));

/** The invoice list with the money strip above it. Opening one swaps the list for the invoice. */
export function InvoicesPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useInvoiceList(status, q);
  const summary = useApi<Summary>(`invoice-summary?today=${localToday()}`, ["invoices", "invoice_lines", "payments", "customers"]);
  const open = selected?.table === "invoices" ? selected.id : null;
  if (open || creating) {
    return (
      <InvoicePage
        key={open ?? "new"} id={open} onClose={() => { onSelect(null); setCreating(false); }}
        onOpen={(id, label) => { setCreating(false); onSelect({ table: "invoices", id, label }); }}
      />
    );
  }
  const s = summary.data;
  return (
    <Page title={label("title.invoices", "Invoices")} subtitle={list.rows.length ? `${list.rows.length}${list.hasMore ? "+" : ""} shown` : undefined} actions={<Button variant="app" icon="plus" onClick={() => setCreating(true)}>New invoice</Button>} width="wide">
      <SampleBusinessNotice />
      {summary.error && !s ? <Callout tone="danger" title="Couldn't load the totals">{summary.error}</Callout> : (
        <StatStrip stats={[
          { label: "outstanding", value: Math.round(s?.outstanding ?? 0), kind: "money", hint: "Sent and not yet fully paid" },
          { label: s && s.overdue_count ? `overdue · ${s.overdue_count} invoice${s.overdue_count === 1 ? "" : "s"}` : "overdue", value: Math.round(s?.overdue ?? 0), kind: "money", hint: "Past the due date and not paid" },
          { label: "paid this month", value: Math.round(s?.paid_this_month ?? 0), kind: "money" },
        ]} />
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Search value={q} onChange={setQ} placeholder="Search invoices" />
        <FilterPill label="Status" options={STATUSES.map((x) => STATUS_LABEL[x])} value={status ? STATUS_LABEL[status] : null} onChange={(v) => setStatus(v ? LABEL_TO_STATUS[v] : null)} />
      </div>
      <Table
        rows={list.rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status], due_text: longDate(r.due_date) }))} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        onRowClick={(r: InvoiceRow) => onSelect({ table: "invoices", id: r.id, label: r.number })}
        empty={<Empty title="No invoices" hint={q || status ? "Nothing matches. Clear the search or the filter." : "Make the first one, or ask the assistant to."} object="receipt" action={<Button onClick={() => setCreating(true)}>New invoice</Button>} />}
        columns={[
          { key: "number", label: "Invoice", render: (r: InvoiceRow) => <span style={{ whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 13 }}>{r.number}</span> },
          { key: "customer_name", label: cap(one()), width: "wide" },
          { key: "issue_date", label: "Issued", kind: "date", phone: "hide" },
          { key: "due_text", label: "Due" },
          { key: "total", label: "Total", align: "end", render: (r: InvoiceRow) => exact(r.total) },
          { key: "balance", label: "Balance", align: "end", render: (r: InvoiceRow) => (r.balance > 0 ? exact(r.balance) : "—") },
          { key: "status_label", label: "Status", kind: "select", tones: STATUS_LABEL_TONES },
        ]}
      />
    </Page>
  );
}
