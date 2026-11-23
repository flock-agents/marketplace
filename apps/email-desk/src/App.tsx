import "./App.css";
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Bullets, Button, Callout, Card, Confirm, Divider, Empty, ErrorCard, Field, Heading, Page, Row, Section, Skeleton, Stack,
  ToastProvider, Value, useToast,
} from "./flock/ui";
import { flockTheme, framedByFlock, onFlockTheme } from "./flock/ui/data/flock-host";
import { changeVoice, deleteMailData, loadVoice, type VoiceAccount, type VoiceChange, type VoiceRow } from "./api";

// Email Desk's own page is its settings: the person's mailboxes, their voice, and "Delete my mail data". Only the person
// reaches the data behind it (server/routes/voice.ts person()); anyone else sees the load refused.

export const COPY = {
  subtitle: "Only you can see this page.",
  voiceIntro: "How your replies are written, learned from mail you sent. Change anything that is wrong. Your changes stay, even when your voice is learned again.",
  deleteIntro: "Deletes the mail this copy of Email Desk holds, and its drafts and your voice. Open reply drafts and follow-up reminders come off Home. Your assistant's memory and your other TODOs stay. Only new mail from now on is read.",
  deleted: "Your mail data is deleted.",
};

/** The light or dark Flock is showing, on the page's root, kept in step with Flock. */
function useFlockTheme(): void {
  useEffect(() => {
    const set = (t: "light" | "dark") => document.documentElement.setAttribute("data-theme", t);
    set(flockTheme());
    return onFlockTheme(set);
  }, []);
}

const clock = (iso?: string) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return iso; }
};

function stateLine(a: VoiceAccount): string {
  if (a.state === "learning") return `Learning your voice from your sent mail. Done by ${clock(a.learningUntil)}.`;
  if (a.state === "ready") return "Voice learned.";
  return "Not learned yet. Replies are written without your voice until it is.";
}

export default function App() {
  return <ToastProvider><EmailDesk /></ToastProvider>;
}

function EmailDesk() {
  useFlockTheme();
  const { show } = useToast();
  const [accounts, setAccounts] = useState<VoiceAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await loadVoice());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // While a mailbox is learning, look again now and then, so the page shows the voice once it is in.
  const learning = accounts?.some((a) => a.state === "learning") ?? false;
  useEffect(() => {
    if (!learning) return;
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, [learning, load]);

  const send = useCallback(async (change: VoiceChange): Promise<boolean> => {
    try {
      await changeVoice(change);
      await load();
      return true;
    } catch (e) {
      show({ message: (e as Error).message, tone: "danger" });
      return false;
    }
  }, [load, show]);

  return (
    <Page title={framedByFlock() ? undefined : "Email Desk"} subtitle={COPY.subtitle} width="narrow">
      <Section title="Your mailboxes">
        {loadError && !accounts ? <ErrorCard message={loadError} onRetry={() => void load()} />
          : !accounts ? <Skeleton variant="card" lines={2} />
          : !accounts.length ? <Empty title="No Gmail connected yet" hint="Connect Gmail to your assistant and your mailbox shows here." />
          : (
            <Card>
              <Stack gap="sm">
                {accounts.map((a, i) => (
                  <Fragment key={a.accountId}>
                    {i > 0 ? <Divider /> : null}
                    <Stack gap="xs">
                      <strong>{a.email ?? a.accountId}</strong>
                      <span className="ed-note">{stateLine(a)}</span>
                    </Stack>
                  </Fragment>
                ))}
              </Stack>
            </Card>
          )}
      </Section>

      {accounts && accounts.length ? (
        <Section title="Your voice">
          <Stack gap="lg">
            <p className="ed-note">{COPY.voiceIntro}</p>
            {accounts.map((a) => <MailboxVoice key={a.accountId} account={a} send={send} />)}
          </Stack>
        </Section>
      ) : null}

      <DeleteMailData onDeleted={load} />
    </Page>
  );
}

function MailboxVoice({ account, send }: { account: VoiceAccount; send: (c: VoiceChange) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const learnLabel = account.state === "ready" ? "Learn again" : "Learn my voice";
  const relearn = async () => {
    setBusy(true);
    await send({ accountId: account.accountId, action: "relearn" });
    setBusy(false);
  };
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading level={3}>{account.email ?? account.accountId}</Heading>
        <Button size="sm" variant="soft" icon="refresh-cw" loading={busy} disabled={account.state === "learning"} onClick={relearn}>{learnLabel}</Button>
      </Row>
      {account.state === "learning" || (!account.groups.length && !account.forgotten.length)
        ? <span className="ed-note">{stateLine(account)}</span> : null}
      {account.groups.map((g) => (
        <Card key={g.title} title={g.title}>
          <Stack gap="md">
            {g.rows.map((r, i) => (
              <Fragment key={`${r.dimension}:${r.part ?? ""}`}>
                {i > 0 ? <Divider /> : null}
                <VoiceRowView account={account} row={r} send={send} />
              </Fragment>
            ))}
          </Stack>
        </Card>
      ))}
      {account.forgotten.length ? (
        <Card title="Forgotten">
          <Stack gap="sm">
            {account.forgotten.map((f) => (
              <Row key={f.dimension} justify="between">
                <span>{f.label}</span>
                <Button size="sm" variant="ghost" onClick={() => void send({ accountId: account.accountId, dimension: f.dimension, action: "restore" })}>Bring back</Button>
              </Row>
            ))}
          </Stack>
        </Card>
      ) : null}
      {account.state === "ready" && account.notLearned.length
        ? <span className="ed-note">Not learned: {account.notLearned.join(", ")}.</span> : null}
    </Stack>
  );
}

function VoiceRowView({ account, row, send }: { account: VoiceAccount; row: VoiceRow; send: (c: VoiceChange) => Promise<boolean> }) {
  const phrases = row.part === "phrases";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const open = () => { setText(phrases ? row.examples.join("\n") : row.value); setEditing(true); };
  const save = async () => {
    setSaving(true);
    const ok = await send({ accountId: account.accountId, dimension: row.dimension, part: row.part, action: "edit", value: text });
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <Stack gap="xs">
      <Row gap="sm">
        <strong>{row.label}</strong>
        {row.editedByYou ? <Value kind="select" value="Changed by you" tones={{ "Changed by you": "accent" }} /> : null}
      </Row>
      {editing ? (
        <Stack gap="sm">
          <Field type="longtext" name={row.dimension} label={row.label} value={text} onChange={(v) => setText(typeof v === "string" ? v : "")} />
          {phrases ? <span className="ed-note">One phrase per line.</span> : null}
          <Row>
            <Button size="sm" variant="app" loading={saving} onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </Row>
        </Stack>
      ) : (
        <>
          {row.value ? <span className="ed-value">{row.value}</span> : null}
          {row.examples.length ? <Bullets items={row.examples} /> : null}
          {row.basis ? <span className="ed-note">{row.basis}</span> : null}
          <Row>
            <Button size="sm" variant="soft" icon="pencil" onClick={open}>Edit</Button>
            {row.part === "abbreviations" ? null
              : <Button size="sm" variant="ghost" onClick={() => void send({ accountId: account.accountId, dimension: row.dimension, action: "forget" })}>Forget</Button>}
            {row.editedByYou
              ? <Button size="sm" variant="ghost" onClick={() => void send({ accountId: account.accountId, dimension: row.dimension, action: "restore" })}>Undo my change</Button>
              : null}
          </Row>
        </>
      )}
    </Stack>
  );
}

function DeleteMailData({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const { show } = useToast();
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);
  const confirm = async () => {
    setAsking(false);
    setDeleting(true);
    try {
      await deleteMailData();
      setDone(true);
      await onDeleted();
    } catch (e) {
      show({ message: (e as Error).message, tone: "danger" });
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Section title="Delete my mail data">
      <Stack gap="md">
        <p className="ed-note">{COPY.deleteIntro}</p>
        {done ? <Callout tone="success" icon="check">{COPY.deleted}</Callout> : null}
        <Row>
          <Button variant="danger" icon="trash-2" loading={deleting} onClick={() => setAsking(true)}>Delete my mail data</Button>
        </Row>
      </Stack>
      <Confirm open={asking} title="Delete your mail data for good?" body="This cannot be undone." tone="danger" confirmLabel="Yes, delete"
        onConfirm={() => void confirm()} onCancel={() => setAsking(false)} />
    </Section>
  );
}
