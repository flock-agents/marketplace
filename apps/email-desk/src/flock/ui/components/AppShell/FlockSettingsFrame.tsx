import { useEffect, useMemo, useRef } from "react";
import { useMe } from "../../data/hooks";
import { onSettingsEmbedMessage, postToSettingsEmbed } from "../../data/flock-settings-bridge";

export interface FlockSettingsFrameProps {
  /** The light or dark the app shows: the page wears it. The address carries the first one (no flash); a change is posted
   *  as settings-theme (no reload), and the theme is posted again after every settings-ready. */
  theme?: "light" | "dark";
  /** The page said these settings are not the viewer's to see (a visitor, signed out, not let in). */
  onUnavailable?(): void;
}

/** Flock's Settings & routines page for this app (/embed/app-settings), in an iframe on Flock's origin (the app is served at
 *  /a/<id>/ on it, so the owner's Flock cookie goes with it). Modelled on FlockChatFrame: the same origin and source checks,
 *  the theme in the address and then by message. Draws nothing until /api/_me names the app. */
export function FlockSettingsFrame(props: FlockSettingsFrameProps) {
  const me = useMe();
  const appId = typeof me.appId === "string" && me.appId ? me.appId : null;
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const firstTheme = useRef(props.theme).current;

  useEffect(() => onSettingsEmbedMessage(() => frame.current, (msg) => {
    const p = latest.current;
    if (msg.type === "flock:settings-unavailable") { p.onUnavailable?.(); return; }
    // Ready: the app's theme, which may have changed since the address was made.
    if (p.theme) postToSettingsEmbed(frame.current, { type: "flock:settings-theme", theme: p.theme });
  }), []);

  const toldTheme = useRef(firstTheme);
  useEffect(() => {
    if (!props.theme || props.theme === toldTheme.current) return;
    toldTheme.current = props.theme;
    postToSettingsEmbed(frame.current, { type: "flock:settings-theme", theme: props.theme });
  }, [props.theme]);

  const src = useMemo(() => (appId ? `/embed/app-settings?${new URLSearchParams({ app: appId, ...(firstTheme ? { theme: firstTheme } : {}) })}` : null),
    [appId, firstTheme]);
  if (!src) return null;
  return <iframe ref={frame} className="fl-settings-frame" src={src} title="Settings & routines" />;
}
