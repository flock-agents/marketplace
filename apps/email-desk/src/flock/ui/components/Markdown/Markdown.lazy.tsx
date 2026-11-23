// The chat block frame's Markdown (vite.chat-frame.config.ts swaps Markdown.tsx for this): the markdown stack (~160 KB)
// is its own file, loaded only by a block that holds a Markdown. The frame loads it before it draws such a block
// (chat-frame/main.tsx), so the first paint is the same as with it in the script; the plain text here is only a guard.
import { useEffect, useState, type ComponentType } from "react";
import "./markdown.css";

type Props = { text: string };
let Impl: ComponentType<Props> | null = null;
let loading: Promise<void> | null = null;
/** Loads the markdown renderer once; resolves (never rejects) when it is here or could not load. */
export function loadMarkdown(): Promise<void> {
  return (loading ??= import("./Markdown").then((m) => { Impl = m.Markdown; }, () => { loading = null; }));
}
export function Markdown(props: Props) {
  const [, loaded] = useState(0);
  useEffect(() => { if (!Impl) void loadMarkdown().then(() => loaded((n) => n + 1)); }, []);
  return Impl ? <Impl {...props} /> : <div className="fl-md"><p>{props.text}</p></div>;
}
