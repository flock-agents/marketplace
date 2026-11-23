import "./miniapp.css";
import "../Button/button.css";
import { Children, isValidElement, useState, type ReactNode } from "react";
import { Icon } from "../Icon/Icon";
import { Tabs, type TabItem } from "../Tabs/Tabs";
import { Tab, type TabProps } from "./Tab";
/** Renderer-owned (not in the Defs): ready is clickable, requested reads "App requested", disabled keeps the words but cannot be pressed. */
export type MakeAppState = "ready" | "requested" | "disabled";
export interface MiniAppProps { title: string; subtitle?: string; makeApp?: boolean; onMakeApp?: () => void; makeAppState?: MakeAppState; children: ReactNode }

/** The frame itself: header, pill tabs, the panels, and an optional footer. Open tab is controlled so Questions can drive it. */
export function MiniFrame({ title, subtitle, makeApp, onMakeApp, makeAppState = "ready", tabs, active, onTab, panels, footer }: {
  title: string; subtitle?: string; makeApp?: boolean; onMakeApp?: () => void; makeAppState?: MakeAppState;
  tabs?: TabItem[]; active?: string; onTab?: (id: string) => void; panels: { id: string; node: ReactNode }[]; footer?: ReactNode;
}) {
  return (
    <section className="fl-mini">
      <div className="fl-mini-head">
        <div className="fl-mini-titles">
          {subtitle ? <span className="fl-mini-sub">{subtitle}</span> : null}
          <span className="fl-mini-title">{title}</span>
        </div>
        {makeApp ? <button type="button" className="fl-mini-app" disabled={makeAppState !== "ready"} onClick={() => onMakeApp?.()}><Icon name={makeAppState === "requested" ? "check" : "app-window"} size={14} />{makeAppState === "requested" ? "App requested" : "Make it an app"}</button> : null}
      </div>
      {tabs && tabs.length > 0 ? <Tabs tabs={tabs} value={active ?? tabs[0].id} onChange={(id) => onTab?.(id)} /> : null}
      {panels.map((p) => <div key={p.id} role="tabpanel" hidden={tabs ? p.id !== (active ?? tabs[0]?.id) : false}>{p.node}</div>)}
      {footer ? <div className="fl-mini-foot">{footer}</div> : null}
    </section>
  );
}

export function MiniApp({ title, subtitle, makeApp, onMakeApp, makeAppState, children }: MiniAppProps) {
  const tabEls = Children.toArray(children).filter((c): c is React.ReactElement<TabProps> => isValidElement(c) && c.type === Tab);
  const [open, setOpen] = useState("0");
  if (tabEls.length === 0) return <MiniFrame title={title} subtitle={subtitle} makeApp={makeApp} onMakeApp={onMakeApp} makeAppState={makeAppState} panels={[{ id: "body", node: children }]} />;
  // One part needs no tab bar: its content is the body.
  if (tabEls.length === 1) return <MiniFrame title={title} subtitle={subtitle} makeApp={makeApp} onMakeApp={onMakeApp} makeAppState={makeAppState} panels={[{ id: "body", node: tabEls[0].props.children }]} />;
  const tabs: TabItem[] = tabEls.map((t, i) => ({ id: String(i), label: t.props.label, count: t.props.count }));
  return <MiniFrame title={title} subtitle={subtitle} makeApp={makeApp} onMakeApp={onMakeApp} makeAppState={makeAppState} tabs={tabs} active={open} onTab={setOpen}
    panels={tabEls.map((t, i) => ({ id: String(i), node: t.props.children }))} />;
}
