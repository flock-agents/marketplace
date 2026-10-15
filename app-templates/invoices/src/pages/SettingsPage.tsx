import { useEffect, useState } from "react";
import { Button, Card, Field, Page, kitFetch, useToast } from "../flock/ui";
import { invoiceSettings } from "../../server/db/constants";

const KEYS = [
  { key: "business.name", label: "Company name (printed at the top of every invoice)", type: "text" },
  { key: "business.gstin", label: "GSTIN (15 characters), or empty when not registered for GST", type: "text" },
  { key: "business.address", label: "Address", type: "longtext" },
  { key: "business.email", label: "Email printed on invoices", type: "text" },
  { key: "business.pay", label: "Where customers pay you (UPI id, bank account and IFSC)", type: "longtext" },
] as const;

/** Your company details: empty until the owner fills them in. A real invoice cannot be issued without a company name. */
export function SettingsPage() {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    kitFetch<{ settings: Record<string, unknown> }>("_app").then((r) => {
      const b = invoiceSettings(r.settings ?? {}).business;
      setV({ "business.name": b.name, "business.gstin": b.gstin, "business.address": b.address, "business.email": b.email, "business.pay": b.pay });
    }).catch(() => setV({}));
  }, []);
  const save = async () => {
    if (!v) return;
    setSaving(true);
    try {
      await kitFetch("_app/settings", { method: "PATCH", body: JSON.stringify({ ...v, "business.gstin": (v["business.gstin"] ?? "").trim().toUpperCase() }) });
      toast.show({ message: "Saved your company details", tone: "success" });
    } catch (e) { toast.show({ message: (e as Error).message || "Couldn't save", tone: "danger" }); }
    setSaving(false);
  };
  return (
    <Page title="Settings" subtitle="Your company details, printed on every invoice" width="wide">
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "grid", gap: 12 }}>
          {KEYS.map((k) => (
            <Field key={k.key} type={k.type} name={k.key} label={k.label} value={v?.[k.key] ?? ""} onChange={(x) => setV({ ...(v ?? {}), [k.key]: String(x ?? "") })} />
          ))}
          <div className="inv-actions"><Button type="submit" variant="app" loading={saving} disabled={!v}>Save</Button></div>
        </form>
      </Card>
    </Page>
  );
}
