import { Button, Card, Page, useChat } from "../flock/ui";

/** What the coach is asked first when the chat opens from here. */
export const SETUP_STARTER = "Set up my fitness dashboard: ask me my name and time zone";

/** Shown while the app does not know who it is for: it is idle (no tracker sync, no plans or summaries) until the coach does. */
export function IdlePage() {
  const { openChat } = useChat();
  return (
    <Page>
      <Card title="Waiting to meet you">
        <p>
          This dashboard is idle until your coach knows who it is for: your name and time zone. Until then nothing runs, no
          tracker sync and no plans or summaries from the coach.
        </p>
        <Button variant="app" icon="message-circle" onClick={() => openChat({ message: SETUP_STARTER, send: true })}>Tell the coach about you</Button>
      </Card>
    </Page>
  );
}
