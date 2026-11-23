import { useState } from "react";
import { Icon, safeHref, safeSrc } from "../flock/ui";

/** A small square picture of an item: the shopping app's product photo, or the item's first letter when there is none or it
 *  does not load. Never a made-up picture. */
export function Thumb({ src, name }: { src: string | null | undefined; name: string }) {
  const [bad, setBad] = useState<string | null>(null);
  const safe = safeSrc(src);
  if (!safe || bad === safe) return <span className="pl-thumb pl-thumb-empty" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
  return <span className="pl-thumb"><img src={safe} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(safe)} /></span>;
}

/** A dish's video as a small play button: its thumbnail when it has one, opening the link in a new tab. */
export function PlayLink({ href, thumbnail, label }: { href: string; thumbnail?: string | null; label: string }) {
  const [bad, setBad] = useState(false);
  const link = safeHref(href), thumb = safeSrc(thumbnail);
  if (!link) return null;
  return (
    <a className="pl-play" href={link} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
      {thumb && !bad ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : null}
      <span className="pl-play-icon"><Icon name="play" size={12} /></span>
    </a>
  );
}
