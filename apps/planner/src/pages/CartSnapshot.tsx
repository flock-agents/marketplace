import "./groceries.css";
import { formatINR } from "../flock/ui";
import { serviceLabel } from "./shared";
import { feesTotal, type CartSnapshot } from "./shopping";

const money = (n: number | null | undefined) => (n != null ? formatINR(n) : "—");

/** A cart as a service built it: each line's product, pack, quantity, price and substitution, the fees and total, and
 *  the screenshot. Read-only: changes to what is bought go through the draft (the Shopping page, or chat). The Shopping
 *  page (a quote, or the frozen order) and the chat's cart-snapshot card both draw this one. */
export function CartSnapshotView({ snapshot }: { snapshot: CartSnapshot }) {
  const fees = feesTotal(snapshot.fees);
  return (
    <div className="pl-snap">
      <div className="pl-snap-head">{serviceLabel(snapshot.service ?? null)} cart · {snapshot.lines.length} line{snapshot.lines.length === 1 ? "" : "s"}</div>
      {snapshot.screenshot_url ? <img className="pl-snap-shot" src={snapshot.screenshot_url} alt="Cart screenshot" /> : null}
      <ul className="pl-snap-lines">
        {snapshot.lines.map((l, i) => (
          <li key={`${i}:${l.name}`} className="pl-snap-line">
            <span className="pl-snap-name">
              <span>{l.name}</span>
              <small>{[l.pack, l.substituted ? `instead of ${typeof l.substituted === "string" ? l.substituted : "what was asked"}` : null].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="pl-snap-qty">×{l.qty}</span>
            <span className="pl-snap-price">{money(l.price != null ? l.price * l.qty : null)}</span>
          </li>
        ))}
      </ul>
      <div className="pl-snap-foot">
        {fees ? <span>Fees {money(fees)}</span> : null}
        <strong>Total {money(snapshot.total)}</strong>
      </div>
    </div>
  );
}
