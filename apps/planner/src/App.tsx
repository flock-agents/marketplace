import { AppShell, AgentChat, Empty, Page, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Plan next week", "Add paneer to the next order", "Save a recipe video"];
const PAGES = [
  { id: "week", nav: "Week", title: "This week's meals", icon: "calendar-days" },
  { id: "shopping", nav: "Shopping", title: "Shopping", icon: "shopping-basket" },
  { id: "recipes", nav: "Recipes", title: "Recipes", icon: "book-open" },
  { id: "family", nav: "Family", title: "Family", icon: "users" },
];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("week");
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "grocery-bag"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={PAGES.map((p) => ({ id: p.id, label: label(`nav.${p.id}`, p.nav), icon: p.icon }))} current={current.id} onNavigate={go}
      chat={{ placement: "side", render: () => <AgentChat placement="side" starters={app.display.starters ?? STARTERS} /> }}
    >
      {/* Placeholders: each page is built on the new tables in a later step of the 3.0 rebuild. */}
      <Page title={label(`title.${current.id}`, current.title)}>
        <Empty title="Nothing here yet" hint="Ask the assistant in the chat to plan your week." />
      </Page>
    </AppShell>
  );
}
