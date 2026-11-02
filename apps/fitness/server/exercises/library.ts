// Plain constants, no imports: both the server and the browser pages read the exercise library.
// Every picture is copied into the app (public/exercises/<slug>.gif), so it loads from the dashboard itself, fast and the same
// every time. Most come from Free Exercise DB (public domain); bird-dog is from wger (CC BY-SA 4.0); McGill curl-up is drawn here;
// the negative pull-up and dead hang are made here from Free Exercise DB's pull-up frames.

export interface Exercise {
  slug: string;
  name: string;
  /** What a plan line may call it, tested against the lower-cased line. The first exercise whose pattern matches wins. */
  match: RegExp;
  cues: readonly string[];
  /** How it keeps the back safe, and what to watch. */
  back: string;
  credit: string;
}

const FREE_EXERCISE_DB = "Free Exercise DB (public domain)";
const MADE_FROM_FREE_EXERCISE_DB = "Made here from Free Exercise DB (public domain)";
const CURL_BACK = "Ribs down, glutes tight: no leaning back or swinging to lift. Sit on a bench with the back supported if it is tired.";
const BAR_BACK = "Brace the core and keep the legs quiet: no kipping or swinging. Step down onto a stool at the end, never drop.";

/** The back-safe exercises the coach programs, most specific pattern first ("side bridge" before "bridge", "chin-up negatives" before "chin-up"). */
export const EXERCISES: readonly Exercise[] = [
  {
    slug: "goblet-squat", name: "Goblet squat", match: /goblet/,
    cues: ["Hold one dumbbell at the chest, elbows under it", "Sit between the heels to a comfortable depth", "Drive up through the whole foot"],
    back: "Chest up and ribs down: stop the depth before the low back rounds.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "supported-single-arm-row", name: "Supported single-arm row", match: /(single|one)[\s-]*arm[\w\s-]*row|dumbbell row|supported row/,
    cues: ["One hand and knee on a bench, back flat", "Pull the dumbbell to the hip, elbow close", "Lower slowly, no twisting"],
    back: "The bench carries the spine: keep it flat and square, no rotating to lift more.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "side-plank", name: "Side plank", match: /side[\s-]*(plank|bridge)/,
    cues: ["Elbow under the shoulder, hips stacked", "Body in one straight line", "Knees bent to make it easier"],
    back: "One of the McGill big three: trains the side core with the spine neutral.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "glute-bridge", name: "Glute bridge", match: /glute[\s-]*bridge|hip[\s-]*bridge|\bbridges?\b/,
    cues: ["Feet flat, hip-width, close to the hips", "Squeeze the glutes to lift the hips", "Pause at the top, ribs down"],
    back: "Lift with the glutes, not by arching: stop when hips, knees and shoulders line up.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "dead-bug", name: "Dead bug", match: /dead[\s-]*bugs?/,
    cues: ["Arms up, hips and knees at 90 degrees", "Breathe out and press the low back down", "Reach the opposite arm and leg, slowly"],
    back: "The low back stays on the floor the whole time: shorten the reach if it lifts.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "bird-dog", name: "Bird-dog", match: /bird[\s-]*dogs?/,
    cues: ["Hands under shoulders, knees under hips", "Reach the opposite arm and leg long", "Hold 5-10 s, hips level"],
    back: "One of the McGill big three: keep the hips square, no arching as the leg goes back.", credit: "wger, by Settebello (CC BY-SA 4.0)",
  },
  {
    slug: "mcgill-curl-up", name: "McGill curl-up", match: /mcgill|curl[\s-]*ups?/,
    cues: ["One knee bent, one leg straight", "Hands under the low back to keep its curve", "Lift head and shoulders an inch as one block, hold 8-10 s"],
    back: "One of the McGill big three: works the front core without bending the spine, unlike a sit-up.", credit: "Drawn for this dashboard",
  },
  {
    slug: "split-squat", name: "Split squat", match: /split[\s-]*squats?/,
    cues: ["Long stance, back heel up", "Lower the back knee straight down", "Torso tall, front knee over the foot"],
    back: "Stay upright and short of pain: a split stance loads the legs with little load on the spine.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "floor-press", name: "Floor press", match: /floor[\s-]*press/,
    cues: ["Lie on the floor, knees bent, feet flat", "Press both dumbbells up over the chest", "Lower until the upper arms touch the floor"],
    back: "The floor stops the range and keeps the back flat: no arching to press.", credit: FREE_EXERCISE_DB,
  },
  {
    slug: "scapular-pull-up", name: "Scapular pull-up", match: /scap(ular)?[\s-]*(pull|hang|shrug)/,
    cues: ["Hang from the bar, arms straight", "Pull the shoulder blades down and back to rise an inch", "Elbows stay straight, lower slowly"],
    back: `The first step to a pull-up: builds the shoulder blades' pull with no swing. ${BAR_BACK}`, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "dead-hang", name: "Dead hang", match: /dead[\s-]*hangs?|bar[\s-]*hangs?|passive[\s-]*hangs?/,
    cues: ["Grip the bar shoulder-width, feet off the floor", "Arms straight, shoulders away from the ears", "Breathe slowly, hold for time"],
    back: "Lets the low back lengthen under its own weight: legs relaxed, and step down rather than drop.", credit: MADE_FROM_FREE_EXERCISE_DB,
  },
  {
    slug: "negative-pull-up", name: "Negative pull-up", match: /(negative|eccentric)[\w\s-]*(pull|chin)|(pull|chin)[\s-]*ups?[\w\s-]*(negative|eccentric)/,
    cues: ["Step up on a stool to start with the chin over the bar", "Lower yourself slowly, 3-5 s, to straight arms", "Step back up, don't jump"],
    back: `Builds strength for full pull-ups. ${BAR_BACK}`, credit: MADE_FROM_FREE_EXERCISE_DB,
  },
  {
    slug: "band-assisted-pull-up", name: "Band-assisted pull-up", match: /(band|assisted)[\w\s-]*(pull|chin)/,
    cues: ["Loop a band over the bar, one knee or foot in it", "Pull the chest towards the bar", "Lower all the way under control"],
    back: `The band takes some weight so the reps stay clean. ${BAR_BACK}`, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "neutral-grip-pull-up", name: "Neutral-grip pull-up", match: /(neutral|parallel)[\s-]*grip[\w\s-]*(pull|chin)|v[\s-]*bar[\s-]*pull/,
    cues: ["Grip the parallel handles, palms facing each other", "Pull the chest up between the hands", "Lower to straight arms"],
    back: `The kindest grip on the shoulders and elbows. ${BAR_BACK}`, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "chin-up", name: "Chin-up", match: /chin[\s-]*ups?\b|\bchins\b/,
    cues: ["Palms facing you, shoulder-width", "Pull until the chin clears the bar", "Lower to straight arms"],
    back: `More biceps than a pull-up, and usually a rep or two easier. ${BAR_BACK}`, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "pull-up", name: "Pull-up", match: /pull[\s-]*ups?/,
    cues: ["Palms facing away, a little wider than the shoulders", "Pull the shoulder blades down, then the chest to the bar", "Lower to straight arms"],
    back: `The bar takes the spine's load off: the hang itself lengthens the low back. ${BAR_BACK}`, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "hammer-curl", name: "Hammer curl", match: /hammer[\s-]*curls?/,
    cues: ["Stand tall, dumbbells at the sides, palms facing in", "Curl up with the elbows pinned", "Lower slowly"],
    back: CURL_BACK, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "bicep-curl", name: "Bicep curl", match: /biceps?|(dumbbell|db)[\s-]*curls?|^curls?\b/,
    cues: ["Stand tall, dumbbells at the sides, palms forward", "Curl up with the elbows pinned", "Lower slowly"],
    back: CURL_BACK, credit: FREE_EXERCISE_DB,
  },
  {
    slug: "elliptical", name: "Elliptical", match: /elliptical|cross[\s-]*trainer/,
    cues: ["Stand tall, light grip on the handles", "Push through the heels", "Steady or intervals, as planned"],
    back: "Low impact cardio: stay upright, no leaning on the handles.", credit: FREE_EXERCISE_DB,
  },
];

/** The library exercise a plan line names, or null. */
export function findExercise(text: string): Exercise | null {
  const line = text.toLowerCase();
  return EXERCISES.find((e) => e.match.test(line)) ?? null;
}

/** Where an exercise's picture is served, relative to the app. */
export const imagePath = (slug: string) => `exercises/${slug}.gif`;
/** The app's own route to an exercise in the library, relative to the app. */
export const libraryPath = (slug: string) => `#/exercises?ex=${slug}`;
