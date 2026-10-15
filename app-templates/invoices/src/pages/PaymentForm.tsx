import { Form } from "../flock/ui";
import { METHODS } from "../../server/db/constants";
import { localToday } from "./shared";

const FIELDS = [
  { type: "money", name: "amount", label: "Amount received", required: true },
  { type: "date", name: "date", label: "Date received", required: true },
  { type: "select", name: "method", label: "How", options: [...METHODS] as string[] },
  { type: "text", name: "ref", label: "Reference (UTR, cheque no.)" },
] as const;

/** Records one payment against an invoice; the amount starts at what is still owed. */
export function PaymentForm({ balance, onSubmit, onCancel }: { balance: number; onSubmit: (v: { amount: number; date: string; method: string; ref: string | null }) => Promise<void>; onCancel: () => void }) {
  return (
    <Form
      fields={[...FIELDS]} initial={{ amount: balance > 0 ? balance : null, date: localToday(), method: "upi" }} submitLabel="Record payment" onCancel={onCancel}
      onSubmit={async (v) => { await onSubmit({ amount: Number(v.amount), date: String(v.date), method: String(v.method ?? "upi"), ref: v.ref ? String(v.ref) : null }); }}
    />
  );
}
