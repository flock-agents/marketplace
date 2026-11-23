import "./productcards.css";
import "../Button/button.css";
import "../Field/field.css";
import { useId, useState } from "react";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import { Image } from "../Image/Image";
import { Value } from "../Value/Value";
import { cx } from "../../tone";
import { formatINR, formatNumber } from "../../format";

export interface ProductPhoto { image: string; alt?: string }
export interface ProductColour { name: string; swatch?: string; image?: string; photos?: ProductPhoto[] }
export interface ProductVariant { id: string; colour?: string; size?: string; price?: number; mrp?: number; delivery?: string; stock?: string; available: boolean }
export interface ProductItem {
  id: string; title: string; brand?: string; rating?: { stars: number; count?: number }; badge?: string;
  bullets?: string[]; details?: string; url?: string; photos?: ProductPhoto[];
  colours?: ProductColour[]; sizes?: string[]; variants: ProductVariant[];
  /** How many more colours the site sells than the card shows (the card says so, linked to the page). */
  moreColours?: number;
  /** Colours and sizes the site sells that the card has not read yet: a button asks for them all (moreAsk). */
  moreOptions?: { colours?: number; sizes?: number };
}
/** The written answer the "See more colours and sizes" button sends; the agent reads every variant on it. */
export const moreAsk = (it: { id: string; title: string }) => `See all colours and sizes: ${it.title} [${it.id}]`;
const plural = (n: number, one: string) => `${n} more ${one}${n === 1 ? "" : "s"}`;
/** "See 7 more colours and 4 more sizes", or null when there is nothing more to read. */
export function moreLabel(m: ProductItem["moreOptions"]): string | null {
  const parts = [m?.colours ? plural(m.colours, "colour") : "", m?.sizes ? plural(m.sizes, "size") : ""].filter(Boolean);
  return parts.length ? `See ${parts.join(" and ")}` : null;
}
/** One line of the cart, as sent on Checkout. */
export interface CartLine { id: string; title: string; colour?: string; size?: string; variantId: string; price?: number }
export type ProductCardsAnswer = CartLine[] | { written: string };
export interface ProductCardsProps {
  items: ProductItem[];
  /** The owner's size; a card opens on a colour that has it. */
  pickedSize?: string;
  /** The button that sends the cart; default "Checkout". */
  submitLabel?: string;
  onSubmit: (answer: ProductCardsAnswer) => void;
  /** Asks the host to open a product page. Default: a new tab (a sandboxed chat frame has no popups, so the chat passes this). */
  onOpenUrl?: (url: string) => void;
}
/** TypeScript-only state the renderer owns: the answer already sent (shown, locked) and a lock. */
export interface ProductCardsState { answer?: ProductCardsAnswer | null; disabled?: boolean }

/** The most lines one cart takes. */
export const MAX_CART_LINES = 10;

// A variant that names no colour (or size) is the one for every colour (or size): a product read with one variant.
/** A title links only to a real web address (owner 2026-10-26): never javascript:, data: or the like. */
const webUrl = (u: string | undefined): string | null => {
  if (!u || u.length > 2048) return null;
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? u : null; } catch { return null; }
};
const openTab = (u: string) => { window.open(u, "_blank", "noopener,noreferrer"); };
/** The shop's name from its address, for "+3 more colours on Amazon": amazon.in → Amazon. */
const siteName = (u: string | null): string => {
  if (!u) return "the site";
  try { const h = new URL(u).hostname.replace(/^www\./, "").split(".")[0]; return h ? h[0].toUpperCase() + h.slice(1) : "the site"; } catch { return "the site"; }
};

const find = (it: ProductItem, colour: string | undefined, size: string | undefined) =>
  it.variants.find((v) => (colour === undefined || v.colour === undefined || v.colour === colour) && (size === undefined || v.size === undefined || v.size === size));
const sells = (it: ProductItem, colour: string | undefined, size: string | undefined) => !!find(it, colour, size)?.available;

/** Opens on the first colour that sells the picked size, else the first that sells anything, else the first. */
function startColour(it: ProductItem, pickedSize?: string): number {
  const cs = it.colours ?? [];
  if (!cs.length) return 0;
  const size = pickedSize && it.sizes?.includes(pickedSize) ? pickedSize : undefined;
  let k = size ? cs.findIndex((c) => sells(it, c.name, size)) : -1;
  if (k < 0) k = cs.findIndex((c) => it.variants.some((v) => (v.colour === undefined || v.colour === c.name) && v.available));
  return k < 0 ? 0 : k;
}
function startSize(it: ProductItem, colour: string | undefined, pickedSize?: string): string | undefined {
  const ss = it.sizes ?? [];
  if (!ss.length) return undefined;
  if (pickedSize && ss.includes(pickedSize)) return pickedSize;
  return ss.find((s) => sells(it, colour, s)) ?? ss[0];
}

function Card({ it, pickedSize, locked, full, inCart, onAdd, onOpenUrl, onMore, fetching }: {
  it: ProductItem; onOpenUrl: (url: string) => void; pickedSize?: string; locked: boolean; full: boolean; inCart: (variantId: string) => boolean; onAdd: (line: CartLine) => void;
  onMore: () => void; fetching: boolean;
}) {
  const [ci, setCi] = useState(() => startColour(it, pickedSize));
  const colour = it.colours?.[ci];
  const [size, setSize] = useState(() => startSize(it, it.colours?.[startColour(it, pickedSize)]?.name, pickedSize));
  const [pi, setPi] = useState(0);
  const [open, setOpen] = useState(false);
  const photos = (colour?.photos?.length ? colour.photos : it.photos) ?? [];
  const p = Math.min(pi, Math.max(0, photos.length - 1));
  const v = find(it, colour?.name, size);
  const ok = !!v?.available;
  const added = !!v && inCart(v.id);
  const showPrice = ok && typeof v!.price === "number";
  const off = ok && typeof v!.price === "number" && typeof v!.mrp === "number" && v!.mrp > v!.price ? Math.round((v!.mrp - v!.price) / v!.mrp * 100) : null;
  const pick = [colour?.name, size].filter(Boolean).join(" · ");
  const href = webUrl(it.url);
  // The last word and the icon stay on one line, so the icon never wraps alone.
  const cut = it.title.trimEnd().lastIndexOf(" ") + 1;
  const lead = it.title.slice(0, cut), last = it.title.slice(cut).trimEnd();
  const go = (d: number) => setPi((p + d + photos.length) % photos.length);

  return (
    <article className="fl-pc-card">
      <div className="fl-pc-photos">
        <div className="fl-pc-main">
          <Image src={photos[p]?.image ?? null} alt={photos[p]?.alt ?? it.title} />
          {photos.length > 1 ? (
            <>
              <button type="button" className="fl-pc-arrow fl-pc-arrow-l" aria-label="Previous photo" onClick={() => go(-1)}>‹</button>
              <button type="button" className="fl-pc-arrow fl-pc-arrow-r" aria-label="Next photo" onClick={() => go(1)}>›</button>
              <span className="fl-pc-n">{p + 1} / {photos.length}</span>
            </>
          ) : null}
        </div>
        {photos.length > 1 ? (
          <div className="fl-pc-thumbs">
            {photos.map((ph, j) => (
              <button key={j} type="button" className={cx("fl-pc-thumb", j === p && "fl-pc-on")} aria-label={`Photo ${j + 1}`} aria-pressed={j === p} onClick={() => setPi(j)}>
                <Image src={ph.image} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="fl-pc-body">
        {it.brand ? <span className="fl-pc-brand">{it.brand}</span> : null}
        <h4 className="fl-pc-title">
          {href ? (
            <a className="fl-pc-link" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); onOpenUrl(href); }}>
              {lead}<span className="fl-pc-tail">{last}<span className="fl-pc-go"><Icon name="external-link" size={13} /></span></span><span className="fl-pc-sr"> (opens in a new tab)</span>
            </a>
          ) : it.title}
        </h4>
        {it.rating ? <span className="fl-pc-rating">★ {it.rating.stars}{typeof it.rating.count === "number" ? ` (${formatNumber(it.rating.count)})` : ""}</span> : null}
        {it.badge ? <span className="fl-pc-badge">{it.badge}</span> : null}
        {showPrice ? (
          <span className="fl-pc-price">
            <b className="fl-pc-now"><Value kind="money" value={v!.price} /></b>
            {off !== null ? <><s className="fl-pc-mrp"><Value kind="money" value={v!.mrp} /></s><span className="fl-pc-off">{off}% off</span></> : null}
          </span>
        ) : null}
        {it.colours?.length ? (
          <div className="fl-pc-pickrow">
            <span className="fl-pc-label">Colour: <b>{colour?.name}</b></span>
            <div className="fl-pc-swatches">
              {it.colours.map((c, j) => (
                <button key={c.name} type="button" className={cx("fl-pc-sw", j === ci && "fl-pc-on", !c.swatch && !c.image && "fl-pc-sw-text")} aria-label={c.name} aria-pressed={j === ci}
                  disabled={locked} style={c.swatch ? { background: c.swatch } : undefined} onClick={() => { setCi(j); setPi(0); }}>
                  {!c.swatch && c.image ? <Image src={c.image} alt="" inline /> : null}
                  {!c.swatch && !c.image ? c.name : null}
                </button>
              ))}
            </div>
            {it.moreColours && it.moreColours > 0 ? (() => {
              const more = `+${it.moreColours} more colour${it.moreColours === 1 ? "" : "s"} on ${siteName(href)}`;
              return href ? (
                <a className="fl-pc-morecol fl-pc-link" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); onOpenUrl(href); }}>
                  {more}<span className="fl-pc-sr"> (opens in a new tab)</span>
                </a>
              ) : <span className="fl-pc-morecol">{more}</span>;
            })() : null}
          </div>
        ) : null}
        {it.sizes?.length ? (
          <div className="fl-pc-pickrow">
            <span className="fl-pc-label">Size</span>
            <div className="fl-pc-sizes">
              {it.sizes.map((s) => {
                const sold = sells(it, colour?.name, s);
                return (
                  <button key={s} type="button" className={cx("fl-pc-size", s === size && "fl-pc-on", !sold && "fl-pc-size-off")} aria-pressed={s === size}
                    disabled={locked || !sold} aria-disabled={!sold ? "true" : undefined} onClick={() => setSize(s)}>{s}</button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!ok ? <span className="fl-pc-none">Not available in this size and colour</span> : null}
        {(() => {
          const label = moreLabel(it.moreOptions);
          if (!label) return null;
          if (fetching) return <span className="fl-pc-fetching" role="status">Fetching every colour and size: up to a minute or two…</span>;
          return <Button variant="soft" size="sm" disabled={locked} onClick={onMore}>{label}</Button>;
        })()}

        {ok && v!.delivery ? <span className="fl-pc-deliv">Delivery <b>{v!.delivery}</b></span> : null}
        {ok && v!.stock ? <span className="fl-pc-stock">{v!.stock}</span> : null}
        {it.bullets?.length ? <ul className="fl-pc-bullets">{it.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul> : null}
        {it.details ? (
          <div className="fl-pc-details">
            {open ? <p>{it.details}</p> : null}
            <button type="button" className="fl-pc-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Less" : "More details"}</button>
          </div>
        ) : null}
        <div className="fl-pc-foot">
          <button type="button" className="fl-btn fl-btn-soft fl-pc-add" disabled={locked || !ok || added || full}
            onClick={() => v && onAdd({ id: it.id, title: it.title, ...(colour ? { colour: colour.name } : {}), ...(size ? { size } : {}), variantId: v.id, ...(typeof v.price === "number" ? { price: v.price } : {}) })}>
            {added ? "In cart" : "Add to cart"}
          </button>
          {pick ? <span className="fl-pc-pick">{pick}</span> : null}
        </div>
      </div>
    </article>
  );
}

export function ProductCards({ items, pickedSize, submitLabel = "Checkout", onSubmit, onOpenUrl = openTab, answer, disabled }: ProductCardsProps & ProductCardsState) {
  const ownId = useId();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draft, setDraft] = useState("");
  const sentCart = Array.isArray(answer) ? answer : null;
  const written = answer && !Array.isArray(answer) ? answer.written : null;
  const locked = !!answer || !!disabled;
  // After a written answer the unsent cart is not shown: only what was sent stays on the bar.
  const lines = sentCart ?? (written !== null ? [] : cart);
  // The total only when every line has a price: a part-total would read as the whole.
  const total = lines.length > 0 && lines.every((l) => typeof l.price === "number") ? lines.reduce((n, l) => n + (l.price as number), 0) : null;
  const useDraft = () => { const t = draft.trim(); if (t && !locked) onSubmit({ written: t }); };

  return (
    <div className={cx("fl-pc", locked && "fl-pc-locked")}>
      <div className="fl-pc-cards">
        {items.map((it) => (
          <Card key={it.id} it={it} pickedSize={pickedSize} locked={locked} full={cart.length >= MAX_CART_LINES} onOpenUrl={onOpenUrl}
            inCart={(id) => lines.some((l) => l.variantId === id)}
            onAdd={(line) => setCart((c) => (c.length >= MAX_CART_LINES || c.some((l) => l.variantId === line.variantId) ? c : [...c, line]))}
            onMore={() => { if (!locked) onSubmit({ written: moreAsk(it) }); }} fetching={written === moreAsk(it)} />
        ))}
      </div>
      <div className="fl-pc-write">
        <label className="fl-pc-sr" htmlFor={ownId}>Your own answer</label>
        <input id={ownId} className="fl-inp" type="text" value={written ?? draft} placeholder="Or write your own answer…" disabled={locked}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); useDraft(); } }} />
        <Button variant="soft" disabled={locked || !draft.trim()} onClick={useDraft}>Send</Button>
      </div>
      <div className="fl-pc-bar">
        <div className="fl-pc-sum">
          <span className="fl-pc-count">{lines.length === 0 ? "Cart is empty" : `${lines.length} ${lines.length === 1 ? "item" : "items"}`}</span>
          {total !== null ? <b className="fl-num">{formatINR(total)}</b> : null}
        </div>
        {lines.length > 0 ? (
          <ul className="fl-pc-lines">
            {lines.map((l) => (
              <li key={l.variantId}>
                <span>{[l.title, [l.colour, l.size].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                {!locked ? <button type="button" className="fl-pc-x" aria-label={`Remove ${l.title}${l.colour || l.size ? " " : ""}${[l.colour, l.size].filter(Boolean).join(" ")}`}
                  onClick={() => setCart((c) => c.filter((x) => x.variantId !== l.variantId))}>×</button> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <Button disabled={locked || cart.length === 0} onClick={() => onSubmit(cart)}>{answer ? "Sent" : submitLabel}</Button>
      </div>
    </div>
  );
}
