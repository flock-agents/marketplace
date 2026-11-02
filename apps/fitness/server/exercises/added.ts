// The exercises the coach adds: rows in the `exercises` table, pictures in the app's data dir (never in the code).
import type { Kit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { exercises } from "../db/schema";
import type { AddedExercise } from "./plan";

export interface AddedRow extends AddedExercise { id: string; gif_url: string | null; added_by: string | null; added_at: string | null }
export interface NewExercise { slug: string; name: string; notes: string | null; gifUrl: string | null; file: string | null; addedBy: string }

export interface ExerciseStore {
  all(): AddedRow[];
  find(slug: string): AddedRow | null;
  add(e: NewExercise): Promise<AddedRow>;
  remove(slug: string): Promise<boolean>;
}

/** Where downloaded pictures live: <data dir>/exercises/<slug>.<ext>. */
export const mediaDir = (dataDir: string) => join(dataDir, "exercises");
export function saveMedia(dataDir: string, file: string, bytes: Uint8Array): void {
  mkdirSync(mediaDir(dataDir), { recursive: true });
  writeFileSync(join(mediaDir(dataDir), file), bytes);
}

export function kitExerciseStore(kit: Kit, dataDir: string): ExerciseStore {
  const all = () => kit.sqlite.query(`SELECT id, slug, name, notes, gif_url, file, added_by, added_at FROM exercises ORDER BY added_at`).all() as AddedRow[];
  const find = (slug: string) => (kit.sqlite.query(`SELECT id, slug, name, notes, gif_url, file, added_by, added_at FROM exercises WHERE slug = ?1`).get(slug) as AddedRow | null) ?? null;
  return {
    all, find,
    async add(e) {
      const at = new Date().toISOString();
      const [row] = await kit.db.insert(exercises).values({ slug: e.slug, name: e.name, notes: e.notes, gif_url: e.gifUrl, file: e.file, added_by: e.addedBy, added_at: at, updated_by: e.addedBy }).returning({ id: exercises.id });
      kit.emitChange("exercises", row.id, "insert", e.addedBy);
      return find(e.slug)!;
    },
    async remove(slug) {
      const row = find(slug);
      if (!row) return false;
      await kit.db.delete(exercises).where(eq(exercises.id, row.id));
      if (row.file) rmSync(join(mediaDir(dataDir), row.file), { force: true });
      kit.emitChange("exercises", row.id, "delete", "owner");
      return true;
    },
  };
}
