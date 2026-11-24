// Canonical bird avatar value: `bird:<species>;color=<c>;head=<h>;face=<f>`.
// Keys are written in a fixed order, `none` is omitted, colour is always present. Anything outside
// the lists (unknown key or value) is not a bird avatar. Values saved before the passport birds
// (2026-11-03) may carry `neck=` and `pose=proper` (penguin only): those are still checked, then dropped.

export const BIRD_SPECIES = [
  "robin", "owl", "penguin", "flamingo", "duck", "toucan", "hen", "crow", "eagle", "parrot",
] as const;
export const BIRD_COLORS = [
  "sky", "tomato", "sunflower", "mint", "lilac", "cocoa", "rose", "moss", "slate", "night",
  "flock", // Flock's own orange: the Flock Assistant's colour, never picked from a name
] as const;
export const BIRD_HEADS = ["none", "tophat", "cap", "beanie", "crown", "headphones", "chef", "flower"] as const;
export const BIRD_FACES = ["none", "specs", "shades", "monocle", "halfmoons"] as const;

export type BirdSpecies = (typeof BIRD_SPECIES)[number];
export type BirdColor = (typeof BIRD_COLORS)[number];
export type BirdHead = (typeof BIRD_HEADS)[number];
export type BirdFace = (typeof BIRD_FACES)[number];

export interface BirdSpec {
  shape: BirdSpecies;
  color: BirdColor;
  head: BirdHead;
  face: BirdFace;
}

export const BIRD_EMOJI: Record<BirdSpecies, string> = {
  robin: "🐦",
  owl: "🦉",
  penguin: "🐧",
  flamingo: "🦩",
  duck: "🦆",
  toucan: "🐦",
  hen: "🐔",
  crow: "🐦‍⬛",
  eagle: "🦅",
  parrot: "🦜",
};

const PREFIX = "bird:";
const BIRD_KEYS: readonly string[] = ["color", "head", "face", "neck", "pose"];
/** Read only from older values, never written. */
const LEGACY_NECKS = ["none", "bowtie", "tie", "scarf", "badge"] as const;

function pick<T extends string>(list: readonly T[], v: string): T | null {
  return (list as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseBirdAvatar(value: string | null | undefined): BirdSpec | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return null;
  const [head, ...pairs] = value.slice(PREFIX.length).split(";");
  const shape = pick(BIRD_SPECIES, head);
  if (!shape) return null;
  const got = new Map<string, string>();
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) return null;
    const key = pair.slice(0, eq);
    if (!BIRD_KEYS.includes(key) || got.has(key)) return null;
    got.set(key, pair.slice(eq + 1));
  }
  const color = pick(BIRD_COLORS, got.get("color") ?? "");
  const hd = pick(BIRD_HEADS, got.get("head") ?? "none");
  const face = pick(BIRD_FACES, got.get("face") ?? "none");
  const neck = pick(LEGACY_NECKS, got.get("neck") ?? "none");
  if (!color || !hd || !face || !neck) return null;
  const pose = got.get("pose");
  if (pose !== undefined && (pose !== "proper" || shape !== "penguin")) return null;
  return { shape, color, head: hd, face };
}

export function formatBirdAvatar(spec: BirdSpec): string {
  const parts = [`${PREFIX}${spec.shape}`, `color=${spec.color}`];
  if (spec.head !== "none") parts.push(`head=${spec.head}`);
  if (spec.face !== "none") parts.push(`face=${spec.face}`);
  return parts.join(";");
}

export function isBirdAvatar(value: unknown): value is string {
  return typeof value === "string" && parseBirdAvatar(value) !== null;
}

// A stable bird for a name: FNV-1a over the lower-cased name picks species and colour; no accessories.
export function birdFromName(name: string): BirdSpec {
  let h = 0x811c9dc5;
  for (const ch of name.toLowerCase()) {
    for (let i = 0; i < ch.length; i++) {
      h ^= ch.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return {
    shape: BIRD_SPECIES[h % 10],
    color: BIRD_COLORS[(h >>> 8) % 10],
    head: "none",
    face: "none",
  };
}
