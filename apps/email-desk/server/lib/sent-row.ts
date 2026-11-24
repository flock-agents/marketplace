// The one piece of Flock's sent-source module the pure rules need: is this journal row a
// sent-folder row. The rest of sent-source reads platform state and stays out of the app.
export const SENT_FOLDER = "sent";

export function isSentRow(e: { raw?: Record<string, unknown> | null }): boolean {
  return !!e?.raw && (e.raw as Record<string, unknown>).folder === SENT_FOLDER;
}
