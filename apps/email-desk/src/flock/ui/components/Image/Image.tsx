import "./image.css";
import { useContext, useState } from "react";
import { cx } from "../../tone";
import { safeSrc } from "../../format";
import { ObjectIcon } from "../ObjectIcon/ObjectIcon";
import { DATA_IMAGE, ImageSourceContext } from "./image-source";
export interface ImageProps { src?: string | null; alt: string; ratio?: "1:1" | "4:3" | "16:9"; object?: string }
/** TypeScript-only: `inline` draws spans, for a picture inside a button (a BigCard option), which holds phrasing content only. */
export interface ImageLayout { inline?: boolean }
export function Image({ src, alt, ratio = "1:1", object, inline }: ImageProps & ImageLayout) {
  const [bad, setBad] = useState<string | null>(null);
  const source = useContext(ImageSourceContext);
  const Tag = inline ? "span" : "div";
  // Only https/http and root-relative paths load; javascript:, data:, file: and //host are refused. Where a source
  // context stands in (the chat frame), its answer is used instead, and a raster data: URL is accepted from it.
  const given = typeof src === "string" ? src.trim() : "";
  const resolved = source && given ? source(given) : null;
  const safe = resolved ? (resolved.src && DATA_IMAGE.test(resolved.src) ? resolved.src : safeSrc(resolved.src)) : safeSrc(src);
  const cls = cx("fl-img", `fl-ratio-${ratio.replace(":", "-")}`);
  if (resolved?.pending) return <Tag className={cx(cls, "fl-img-pending")} role="img" aria-label={alt} aria-busy="true" />;
  if (!safe || bad === safe) {
    return <Tag className={cx(cls, "fl-img-empty")} role="img" aria-label={alt}>{object ? <ObjectIcon name={object} size={48} /> : <span />}</Tag>;
  }
  return <Tag className={cls}><img src={safe} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(safe)} /></Tag>;
}
