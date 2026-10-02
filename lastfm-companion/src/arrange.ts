import { stylesFor } from "./orchestrate";
import { Part, PartNote, Song } from "./song";

export interface GenerateOptions {
  bpm: number;
  beatsPerBar: number;
  durationMs: number;
  tags: string[];
  seed: string;
  /** Published key from GetSongBPM, e.g. "C♯m", "Eb", "F#". */
  key?: string;
  /** 0-100 from GetSongBPM: high values get a four-on-the-floor groove and busier hats. */
  danceability?: number;
}

const NOTE_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(key: string | undefined): { root: number; minor: boolean } | null {
  const m = key?.trim().match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(m(?:in(?:or)?)?|maj(?:or)?)?\b/);
  if (!m) return null;
  const shift = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return { root: (NOTE_NAMES[m[1].toUpperCase()] + shift + 12) % 12, minor: m[3] !== undefined && m[3].startsWith("m") && !m[3].startsWith("maj") };
}

function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Block = "intro" | "build" | "main" | "break" | "outro";

export function form(totalBars: number): Block[] {
  const bars: Block[] = [];
  const push = (block: Block, count: number) => {
    for (let i = 0; i < count && bars.length < totalBars - 2; i++) bars.push(block);
  };
  push("intro", 4);
  push("build", 4);
  for (let round = 0; bars.length < totalBars - 2; round++) {
    push("main", 8);
    push(round % 2 === 0 ? "main" : "break", round % 2 === 0 ? 8 : 4);
    if (round % 2 === 1) push("build", 2);
  }
  while (bars.length < totalBars) bars.push("outro");
  return bars;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

// A bar-aligned arrangement for songs with no MIDI: intro, build, main and break blocks that bring
// sections in on bar lines, with key, progression and groove picked from the Last.fm tags and a seed.
export function generateSong(options: GenerateOptions): Song {
  const random = rng(options.seed);
  const styles = stylesFor(options.tags);
  const text = options.tags.join(" ").toLowerCase();
  const key = parseKey(options.key);
  const minor = key ? key.minor : styles.has("balkan") || /metal|dark|sad|goth|doom|emo|minor|melanchol|ambient|trap/.test(text);
  const scale = styles.has("balkan") && minor ? HARMONIC_MINOR : minor ? MINOR : MAJOR;
  const progression = styles.has("balkan") && minor ? [0, 3, 4, 0] : styles.has("classical") ? [0, 3, 4, 0] : minor ? [0, 5, 2, 6] : [0, 4, 5, 3];
  const randomRoot = Math.floor(random() * 12);
  const root = key ? key.root : randomRoot;
  const fourOnFloor = styles.has("electronic") || (options.danceability ?? 0) >= 70;
  const beatMs = 60000 / options.bpm;
  const barMs = beatMs * options.beatsPerBar;
  const totalBars = Math.max(12, Math.round(options.durationMs / barMs));
  const bars = form(totalBars);

  const pitch = (degree: number, octave: number) => 12 * (octave + 1) + root + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
  const drums: PartNote[] = [];
  const bass: PartNote[] = [];
  const chords: PartNote[] = [];
  const melody: PartNote[] = [];
  const hit = (list: PartNote[], note: number, velocity: number, timeMs: number, durationMs: number) => list.push({ note, velocity, timeMs, durationMs });

  const phrase = Array.from({ length: 4 }, () =>
    Array.from({ length: options.beatsPerBar * 2 }, () => (random() < 0.55 ? Math.floor(random() * 5) - 2 : null))
  );

  bars.forEach((block, bar) => {
    const t = bar * barMs;
    const degree = progression[bar % progression.length];
    const triad = [pitch(degree, 4), pitch(degree + 2, 4), pitch(degree + 4, 4)];
    const first = bar === 0 || bars[bar - 1] !== block;
    const last = bar === bars.length - 1;
    const nextBlock = bars[bar + 1];

    if (block === "outro") {
      if (bar === bars.length - 2 || last) triad.forEach(n => hit(chords, n, 80, t, barMs));
      if (last) {
        hit(bass, pitch(0, 2), 110, t, barMs);
        hit(drums, 36, 120, t, 200);
        hit(drums, 49, 120, t, 200);
      } else {
        hit(bass, pitch(degree, 2), 90, t, barMs);
      }
      return;
    }

    triad.forEach(n => hit(chords, n, block === "intro" ? 60 : 75, t, barMs * 0.98));

    if (block === "build" || block === "main") {
      const step = block === "main" ? beatMs / 2 : beatMs;
      for (let at = 0; at < barMs - 1; at += step) hit(bass, pitch(degree, 2), block === "main" ? 100 : 85, t + at, step * 0.9);
      for (let beat = 0; beat < options.beatsPerBar; beat++) {
        const at = t + beat * beatMs;
        if (fourOnFloor || beat === 0 || (block === "main" && beat === 2 && options.beatsPerBar % 2 === 0)) hit(drums, 36, beat === 0 ? 115 : 100, at, 100);
        if (block === "main" && beat % 2 === 1) hit(drums, 38, 105, at, 100);
        if (block === "main") {
          hit(drums, 42, 80, at, 50);
          hit(drums, 42, 65, at + beatMs / 2, 50);
        }
      }
      if (first) hit(drums, 49, 115, t, 200);
      if (nextBlock && nextBlock !== block && nextBlock !== "outro") {
        const fillAt = t + barMs - beatMs;
        [50, 48, 45, 41].forEach((tom, i) => hit(drums, tom, 90 + i * 5, fillAt + (i * beatMs) / 4, 80));
      }
    }

    if (block === "main" || block === "break") {
      const line = phrase[bar % 4];
      let current = progression[bar % progression.length] + 7;
      line.forEach((move, i) => {
        if (move === null) return;
        current = i === 0 ? degree + 7 : Math.max(3, Math.min(13, current + move));
        hit(melody, pitch(current, 4), block === "main" ? 95 : 80, t + (i * beatMs) / 2, beatMs * 0.45);
      });
    }
  });

  const leadProgram = styles.has("electronic") ? 81 : styles.has("classical") ? 40 : 73;
  const parts: Part[] = [
    { name: "drums", program: 0, drums: true, role: "drums", notes: drums },
    { name: "bass", program: 33, drums: false, role: "bass", notes: bass },
    { name: "chords", program: styles.has("classical") ? 19 : 48, drums: false, role: "chords", notes: chords },
    { name: "melody", program: leadProgram, drums: false, role: "melody", notes: melody }
  ];
  return { bpm: options.bpm, beatsPerBar: options.beatsPerBar, durationMs: totalBars * barMs, parts };
}
