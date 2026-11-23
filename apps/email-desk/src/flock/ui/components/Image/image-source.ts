import { createContext } from "react";

/** What a picture's address stands for where it is drawn: `src` the address to load (null: no picture), `pending`
 *  while it is still being fetched. */
export interface ImageState { src: string | null; pending?: boolean }

/**
 * Where an Image's `src` is read from. Apps leave it unset: the address loads as given. The chat block frame may load
 * nothing from the network (its CSP is `img-src data:`), so it sets one that hands back the picture the chat fetched
 * for it, as a data: URL, or pending while that fetch runs (chat-ui frame, ImagesProvider).
 */
export const ImageSourceContext = createContext<((src: string) => ImageState) | null>(null);

/** A raster picture as a data: URL (never SVG, which can carry script): accepted only from an ImageSourceContext. */
export const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/;
