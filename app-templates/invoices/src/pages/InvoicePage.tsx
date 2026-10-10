import { useState } from "react";
import { Button, Callout, Card, Confirm, Empty, ErrorCard, LineItems, Page, Skeleton, Value, formatINR, kitFetch, useToast } from "../flock/ui";
import { InvoiceEditor } from "./InvoiceEditor";
import { PaymentForm } from "./PaymentForm";
import { SampleBusinessNotice } from "./SampleBusinessNotice";
import { STATUS_TONES, localToday, longDate, one, removeRow, undoChange, useApi, useInvoiceSettings, type InvoiceDetail, type Seller } from "./shared";

const exact = (n: number) => formatINR(n, { exact: true });
const METHOD_LABEL: Record<string, string> = { upi: "UPI", bank: "Bank transfer", cash: "Cash", card: "Card" };

/** One invoice: the printable document, its payments, and the buttons that change it. `id` null means a new invoice. */
export function InvoicePage({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string, label: string) => void }) {
  const [attempt, setAttempt] = useState(0);
  return <InvoiceBody key={attempt} id={id} onClose={onClose} onOpen={onOpen} retry={() => setAttempt((n) => n + 1)} />;
}

function InvoiceBody({ id, onClose, onOpen, retry }: { id: string | null; onClose: () => void; onOpen: (id: string, label: string) => void; retry: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<InvoiceDetail>(id ? `invoice/${id}?today=${localToday()}` : null, ["invoices", "invoice_lines", "payments", "customers", "_settings"]);   // a draft shows the business settings as they are now
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [asking, setAsking] = useState<null | "delete" | "void" | "payment">(null);
  const [payToDelete, setPayToDelete] = useState<string | null>(null);
  const settings = useInvoiceSettings();

  const back = <Button size="sm" variant="ghost" icon="arrow-left" onClick={onClose}>All invoices</Button>;
  if (!id) {
    return (
      <Page title="New invoice" actions={back} width="wide">
        <SampleBusinessNotice />
        <Card><InvoiceEditor detail={null} onSaved={(newId, number) => { toast.show({ message: `Saved ${number}`, tone: "success" }); onOpen(newId, number); }} onCancel={onClose} /></Card>
      </Page>
    );
  }
  if (loading && !data) return <Page title="Invoice" actions={back}><Skeleton variant="card" lines={6} /></Page>;
  if (error && !data) return <Page title="Invoice" actions={back}><ErrorCard title="Couldn't open this invoice" message={error} onRetry={retry} /></Page>;
  if (!data) return <Page title="Invoice" actions={back}><Empty title="This invoice isn't here" hint="It may have been deleted." object="receipt" action={<Button onClick={onClose}>Back to invoices</Button>} /></Page>;

  const { invoice, customer, lines, payments, totals, status, balance, paid, total } = data;
  // An issued invoice prints the seller as it was when issued (the server's copy); only a draft shows the live settings.
  const seller: Seller = data.seller ?? { ...settings.business, state: settings.seller_state };
  const registered = data.gst_registered ?? !!seller.gstin;   // not registered: no tax, so no GST column or CGST/SGST/IGST rows
  const patchInvoice = async (patch: Record<string, unknown>): Promise<string | undefined> => {
    const r = await kitFetch<{ changeId?: string }>(`_data/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await reload(); return r?.changeId;
  };
  const fail = (m: string) => toast.show({ message: m, tone: "danger" });

  const recordPayment = async (v: { amount: number; date: string; method: string; ref: string | null }) => {
    if (!(v.amount > 0)) { fail("Enter an amount above zero"); return; }
    try {
      await kitFetch("_data/payments", { method: "POST", body: JSON.stringify({ invoice_id: invoice.id, ...v }) });
      if (Math.round((balance - v.amount) * 100) <= 0 && invoice.status !== "paid") await patchInvoice({ status: "paid" });
      else await reload();
      setPaying(false); toast.show({ message: `Recorded ${exact(v.amount)}`, tone: "success" });
    } catch (e) { fail((e as Error).message || "Couldn't record the payment"); }
  };
  const removePayment = async () => {
    const pid = payToDelete; setPayToDelete(null); setAsking(null);
    if (!pid) return;
    try {
      const changeId = await removeRow("payments", pid);
      if (invoice.status === "paid") await patchInvoice({ status: "sent" });   // no longer settled
      await reload();
      toast.show({ message: "Deleted the payment", tone: "success", action: changeId ? { label: "Undo", onClick: () => { void undoChange(changeId).then(reload).catch(() => fail("Couldn't undo")); } } : undefined });
    } catch (e) { fail((e as Error).message || "Couldn't delete the payment"); }
  };
  const markSent = async () => { try { await patchInvoice({ status: "sent" }); toast.show({ message: `${invoice.number} is marked as sent`, tone: "success" }); } catch (e) { fail((e as Error).message || "Couldn't update"); } };
  const voidIt = async () => {
    setAsking(null);
    try {
      const changeId = await patchInvoice({ status: "void" });
      toast.show({ message: `Voided ${invoice.number}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void undoChange(changeId).then(reload).catch(() => fail("Couldn't undo")); } } : undefined });
    }
    catch (e) { fail((e as Error).message || "Couldn't void"); }
  };
  const deleteIt = async () => {
    setAsking(null);
    try {
      const changeId = await removeRow("invoices", invoice.id);
      onClose();
      toast.show({ message: `Deleted ${invoice.number}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void undoChange(changeId).catch(() => fail("Couldn't undo")); } } : undefined });
    } catch (e) { fail((e as Error).message || "Couldn't delete"); }
  };

  const canPay = (status === "sent" || status === "overdue") && balance > 0;
  const actions = (
    <>
      {back}
      {editing || status !== "draft" ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}{/* an issued invoice is a record: void it and issue a new one */}
      <Button size="sm" variant="soft" icon="printer" onClick={() => window.print()}>Print / Save as PDF</Button>
    </>
  );

  return (
    <Page title={invoice.number} subtitle={customer?.name ?? `Unknown ${one()}`} actions={<span className="inv-actions no-print">{actions}</span>} width="wide">
      {status === "draft" ? <SampleBusinessNotice /> : null}
      {editing && status === "draft" ? (
        <Card title="Edit invoice">
          <InvoiceEditor detail={data} onCancel={() => setEditing(false)} onSaved={async (_id, _number, removed) => {
            setEditing(false); await reload();
            // Removed lines come back with Undo, newest first, as the kit's other deletes do.
            const undoRemoved = async () => { for (const c of [...removed].reverse()) await undoChange(c); await reload(); };
            toast.show({ message: removed.length ? `Saved, ${removed.length} line${removed.length === 1 ? "" : "s"} removed` : "Saved", tone: "success",
              action: removed.length ? { label: "Undo", onClick: () => { void undoRemoved().catch(() => fail("Couldn't undo")); } } : undefined });
          }} />
        </Card>
      ) : (
        <>
          {status === "overdue" ? <div className="no-print"><Callout tone="danger" title={`${data.days_overdue} day${data.days_overdue === 1 ? "" : "s"} overdue`}>{exact(balance)} is still owed. Ask the assistant to draft a reminder; it will not send anything without your yes.</Callout></div> : null}
          <div className="inv-actions no-print">
            {status === "draft" ? <Button variant="app" icon="send" onClick={markSent}>Mark as sent</Button> : null}
            {canPay ? <Button variant="app" icon="indian-rupee" onClick={() => setPaying(true)}>Record payment</Button> : null}
            {status !== "void" ? <Button variant="ghost" icon="ban" onClick={() => setAsking("void")}>Void</Button> : null}
            {status === "draft" ? <Button variant="ghost" icon="trash" onClick={() => setAsking("delete")}>Delete</Button> : null}{/* an issued number is voided, never freed: invoice serials run without gaps */}
          </div>
          <article className="inv-sheet" aria-label={`Invoice ${invoice.number}`}>
            <div className="inv-top">
              <div className="inv-biz"><b>{seller.name}</b>{seller.address ? <span>{seller.address}</span> : null}{seller.gstin ? <span>GSTIN {seller.gstin}</span> : null}{seller.email ? <span>{seller.email}</span> : null}</div>
              <div className="inv-title">
                <h2>{registered ? "Tax invoice" : "Invoice"}</h2><b>{invoice.number}</b>
                <span>Issued {longDate(invoice.issue_date)}</span><span>Due {longDate(invoice.due_date)}</span>
                <span className="inv-chip"><Value kind="select" value={status} tones={STATUS_TONES} /></span>
              </div>
            </div>
            <div className="inv-parties">
              <div className="inv-party"><h3>Bill to</h3>
                <b>{customer?.name ?? `Unknown ${one()}`}</b>
                {customer?.address ? <span>{customer.address}</span> : null}
                {customer?.gstin ? <span>GSTIN {customer.gstin}</span> : null}
                {customer?.email ? <span>{customer.email}</span> : null}
              </div>
              <div className="inv-party"><h3>Supply</h3><span>{!registered ? "No tax charged: the seller is not registered" : data.inter_state ? "Interstate: IGST" : "Within the state: CGST + SGST"}</span>{data.place_of_supply ? <span>Place of supply: state code {data.place_of_supply}</span> : null}</div>
            </div>
            <LineItems rows={lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unit_price: l.unit_price, gst_rate: l.gst_rate }))} totals={totals} noTax={!registered} readOnly />
            {paid > 0 ? <div className="inv-due"><span>Received</span><b>{exact(paid)}</b></div> : null}
            <div className={`inv-due ${status === "overdue" ? "inv-due-late" : ""}`}><span>{status === "paid" ? "Paid in full" : status === "void" ? "Void" : "Balance due"}</span><b>{exact(status === "paid" ? total : balance)}</b></div>
            {invoice.notes ? <div className="inv-foot"><span>{invoice.notes}</span></div> : null}
            {seller.pay ? <div className="inv-foot"><span>Pay to: {seller.pay}</span></div> : null}
          </article>
          <div className="no-print"><Card title="Payments" meta={payments.length ? `${exact(paid)} received of ${exact(total)}` : "Nothing received yet"} actions={canPay ? <span className="no-print"><Button size="sm" variant="soft" icon="plus" onClick={() => setPaying(true)}>Record payment</Button></span> : undefined}>
            <div className="no-print">
              {paying ? <PaymentForm balance={balance} onSubmit={recordPayment} onCancel={() => setPaying(false)} /> : null}
              {payments.length === 0 && !paying ? <p className="inv-note">{status === "draft" ? "Payments can be recorded once the invoice is sent." : status === "void" ? "This invoice is void." : "No payments recorded yet."}</p> : null}
              {payments.map((p) => (
                <div className="inv-pay-row" key={p.id}>
                  <span><b>{exact(p.amount)}</b><small>{longDate(p.date)} · {METHOD_LABEL[p.method] ?? p.method}{p.ref ? ` · ${p.ref}` : ""}</small></span>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => { setPayToDelete(p.id); setAsking("payment"); }}>Delete</Button>
                </div>
              ))}
            </div>
          </Card></div>
        </>
      )}
      <Confirm open={asking === "delete"} title={`Delete ${invoice.number}?`} body="Its lines and payments stay with it, so Undo brings everything back for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={deleteIt} onCancel={() => setAsking(null)} />
      <Confirm open={asking === "void"} title={`Void ${invoice.number}?`} body="A voided invoice no longer counts as owed. You can undo it for a few seconds." confirmLabel="Void" tone="danger" onConfirm={voidIt} onCancel={() => setAsking(null)} />
      <Confirm open={asking === "payment"} title="Delete this payment?" body="The balance goes back up. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={removePayment} onCancel={() => { setAsking(null); setPayToDelete(null); }} />
    </Page>
  );
}
