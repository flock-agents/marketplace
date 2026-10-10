import { useEffect, useState } from "react";
import { Callout, kitFetch, subscribeEvents } from "../flock/ui";
import { invoiceSettings, sampleBusinessFields, type InvoiceSettings } from "../../server/db/constants";

/** "Sample business details": shown while the business settings are still the template's sample, on the list and on a draft. Nothing
 *  until the settings have loaded, so a real business never sees it flash. Hidden when printing. */
export function SampleBusinessNotice() {
  const [s, setS] = useState<InvoiceSettings | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { kitFetch<{ settings: Record<string, unknown> }>("_app").then((r) => { if (live) setS(invoiceSettings(r.settings ?? {})); }).catch(() => { /* no notice without the settings */ }); };
    load();
    const off = subscribeEvents((e) => { if (e.table === "_settings") load(); }, load);
    return () => { live = false; off(); };
  }, []);
  const fields = s ? sampleBusinessFields(s) : [];
  if (!s || !fields.length) return null;
  const words: Record<string, string> = { name: "business name", gstin: "GSTIN", address: "address", pay: "payment details" };
  return (
    <div className="no-print">
      <Callout tone="warning" title="Sample business details">
        {`Still the sample: ${fields.map((f) => words[f]).join(", ")}. Invoices print these under your name. Ask the assistant to set yours.`}
      </Callout>
    </div>
  );
}
