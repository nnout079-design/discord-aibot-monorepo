import { Rig } from "./rig";
import { moveIntoRange, Score, ScoreNote, ScoreSource } from "./score";
import { Part, PartNote, Role, Song } from "./song";

export type Style = "classical" | "electronic" | "bangla" | "balkan" | "taiko" | "roman" | "hardanger";

export const STYLE_TAGS: Record<Style, RegExp> = {
  classical: /classical|orchestral|symphon|soundtrack|score|choral|choir|gospel|church|hymn|baroque|opera|cinematic|epic/,
  electronic: /electro|edm|house|techno|trance|synth|dance|dubstep|drum and bass|dnb|ambient|idm/,
  bangla: /bangla|bengali|bangladesh|indian|bollywood|desi|hindustani|qawwali|baul/,
  balkan: /balkan|gypsy|romani|klezmer|turbo ?folk|serbian|bulgarian|macedonian|bosnian|greek/,
  taiko: /japan|taiko|j-?rock|j-?pop|anime|visual kei|enka/,
  roman: /epic|cinematic|trailer|soundtrack|heroic|war|battle|symphonic metal|power metal|italian/,
  hardanger: /folk|norw|nordic|scandinav|celtic|irish|viking|fiddle/
};

export function stylesFor(tags: string[], all = false): Set<Style> {
  if (all) return new Set(Object.keys(STYLE_TAGS) as Style[]);
  const text = tags.join(" ").toLowerCase();
  return new Set((Object.keys(STYLE_TAGS) as Style[]).filter(style => STYLE_TAGS[style].test(text)));
}

// GM program family -> sections that split the part by pitch (first section whose range fits).
function familySections(program: number): string[] {
  if (program <= 7) return ["harp", "organSwell"];
  if (program <= 15) return ["harp"];
  if (program <= 23) return ["organGreat", "organSwell"];
  if (program <= 31) return ["violas", "cellos"];
  if (program <= 39) return ["bassA"];
  if (program <= 47) return ["violins1", "violins2", "violas", "cellos", "basses"];
  if (program >= 52 && program <= 54) return ["choirSoprano", "choirAlto", "choirTenor", "choirBass"];
  if (program <= 55) return ["violins1", "violas", "cellos"];
  if (program <= 63) return ["trumpets", "horns", "trombones", "tuba"];
  if (program <= 71) return ["oboes", "clarinets", "bassoons"];
  if (program <= 79) return ["flutes", "clarinets"];
  if (program <= 87) return ["moogA"];
  if (program <= 103) return ["moogB"];
  if (program === 104 || program === 106 || program === 107) return ["banglaSitar"];
  if (program === 105) return ["banglaDotara"];
  if (program === 109) return ["balkanGaida"];
  if (program === 110) return ["hardanger"];
  if (program === 111) return ["balkanClarinet"];
  if (program <= 111) return ["banglaSitar"];
  if (program === 116) return ["taikoOdaiko"];
  if (program <= 119) return ["timpani"];
  return [];
}

const KICKS = new Set([35, 36]);
const SNARES = new Set([37, 38, 39, 40]);
const HATS = new Set([42, 44, 46]);
const CYMBALS = new Set([49, 51, 52, 55, 57, 59]);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

export function assignRoles(parts: Part[]): Map<Part, Role> {
  const roles = new Map<Part, Role>();
  const pitched = parts.filter(p => !p.drums);
  for (const part of parts) {
    if (part.role) roles.set(part, part.role);
    else if (part.drums) roles.set(part, "drums");
    else if (part.program >= 32 && part.program <= 39) roles.set(part, "bass");
  }
  const free = pitched.filter(p => !roles.has(p));
  if (![...roles.values()].includes("bass") && free.length > 1) {
    const lowest = free.reduce((a, b) => median(a.notes.map(n => n.note)) <= median(b.notes.map(n => n.note)) ? a : b);
    if (median(lowest.notes.map(n => n.note)) < 52) roles.set(lowest, "bass");
  }
  if (![...roles.values()].includes("melody")) {
    const candidates = pitched.filter(p => !roles.has(p) && p.notes.length >= 16);
    if (candidates.length) {
      const top = candidates.reduce((a, b) => median(a.notes.map(n => n.note)) >= median(b.notes.map(n => n.note)) ? a : b);
      roles.set(top, "melody");
    }
  }
  for (const part of pitched) if (!roles.has(part)) roles.set(part, "chords");
  return roles;
}

// The highest note of each onset cluster, so a melody doubled by one voice stays a single line.
function topLine(notes: PartNote[]): PartNote[] {
  const byTime = new Map<number, PartNote>();
  for (const n of notes) {
    const key = Math.round(n.timeMs / 20);
    const prev = byTime.get(key);
    if (!prev || n.note > prev.note) byTime.set(key, n);
  }
  return [...byTime.values()];
}

interface Layer {
  section: string;
  from: Role;
  transpose?: number;
  velocity?: number;
  /** Pitched section that turns drum hits into this fixed pitch, or a drum section mapping GM drum notes. */
  drumMap?: Map<number, number> | number;
  filter?: Set<number>;
  top?: boolean;
}

const drumMap = (pairs: [Set<number>, number][]) => new Map(pairs.flatMap(([set, note]) => [...set].map(n => [n, note] as [number, number])));

const ALWAYS: Layer[] = [
  { section: "percussionB", from: "drums", velocity: 0.8 },
  { section: "bassB", from: "bass", velocity: 0.9 },
  { section: "organPedal", from: "bass", velocity: 0.7 },
  { section: "choirSoprano", from: "melody", velocity: 0.75, top: true },
  { section: "timpani", from: "drums", drumMap: 43, filter: KICKS, velocity: 0.7 }
];

const STYLE_LAYERS: Record<Style, Layer[]> = {
  classical: [
    { section: "violins1", from: "melody", top: true },
    { section: "flutes", from: "melody", transpose: 12, velocity: 0.7, top: true },
    { section: "cellos", from: "bass", transpose: 12 },
    { section: "basses", from: "bass" },
    { section: "organGreat", from: "chords", velocity: 0.7 },
    { section: "choirAlto", from: "chords", velocity: 0.7 },
    { section: "choirTenor", from: "chords", velocity: 0.7 },
    { section: "choirBass", from: "bass", velocity: 0.7 },
    { section: "horns", from: "chords", velocity: 0.6 }
  ],
  electronic: [
    { section: "moogA", from: "melody", top: true },
    { section: "moogB", from: "chords", velocity: 0.8 }
  ],
  bangla: [
    { section: "banglaSitar", from: "melody", top: true },
    { section: "banglaBansuri", from: "melody", transpose: 12, velocity: 0.7, top: true },
    { section: "banglaDotara", from: "chords", velocity: 0.8 },
    { section: "banglaEsraj", from: "chords", velocity: 0.6 },
    { section: "banglaDhol", from: "drums", drumMap: drumMap([[KICKS, 64], [SNARES, 63]]) },
    { section: "banglaTabla", from: "drums", drumMap: drumMap([[HATS, 60], [SNARES, 61]]), velocity: 0.8 }
  ],
  balkan: [
    { section: "balkanClarinet", from: "melody", top: true },
    { section: "balkanGaida", from: "melody", velocity: 0.6, top: true },
    { section: "balkanAccordion", from: "chords", velocity: 0.8 },
    { section: "balkanBrass", from: "bass", transpose: 12, velocity: 0.8 },
    { section: "balkanTapan", from: "drums", drumMap: drumMap([[KICKS, 41], [SNARES, 45]]) }
  ],
  taiko: [
    { section: "taikoOdaiko", from: "drums", drumMap: 36, filter: KICKS },
    { section: "taikoShime", from: "drums", drumMap: 72, filter: SNARES, velocity: 0.8 },
    { section: "taikoChappa", from: "drums", drumMap: drumMap([[CYMBALS, 55], [HATS, 55]]), velocity: 0.6 }
  ],
  roman: [
    { section: "romanCornu", from: "melody", transpose: -12, top: true },
    { section: "romanBuccina", from: "chords", velocity: 0.7, top: true },
    { section: "romanTuba", from: "bass" },
    { section: "romanWarDrums", from: "drums", drumMap: 36, filter: new Set([...KICKS, ...SNARES]) }
  ],
  hardanger: [{ section: "hardanger", from: "melody", top: true }]
};

export interface OrchestrateOptions {
  tags: string[];
  allStyles?: boolean;
  source: ScoreSource;
  title: string;
}

// Maps each part of a song onto rig sections by instrument family, then doubles the melody, chords,
// bass and drums onto extra sections: some always, the rest by style from the Last.fm tags.
export function orchestrate(song: Song, rig: Rig, options: OrchestrateOptions): Score {
  const notes: ScoreNote[] = [];
  const has = (section: string) => section in rig.sections;
  const add = (section: string, n: PartNote, note: number, velocityScale = 1) => {
    if (!has(section)) return;
    const pitched = !rig.sections[section].drums;
    notes.push({
      section,
      note: pitched ? moveIntoRange(note, rig.sections[section].range) : note,
      velocity: Math.max(1, Math.round(n.velocity * velocityScale)),
      timeMs: n.timeMs,
      durationMs: n.durationMs
    });
  };

  const roles = assignRoles(song.parts);
  for (const part of song.parts) {
    if (part.drums) {
      for (const n of part.notes) add("percussionA", n, n.note);
      continue;
    }
    const candidates = roles.get(part) === "bass" ? ["bassA"] : familySections(part.program).filter(has);
    if (candidates.length === 0) continue;
    for (const n of part.notes) {
      const fit = candidates.find(name => {
        const range = rig.sections[name].range;
        return !range || (n.note >= range[0] && n.note <= range[1]);
      });
      add(fit ?? candidates[0], n, n.note);
    }
  }

  const byRole = (role: Role) => song.parts.filter(p => roles.get(p) === role).flatMap(p => p.notes);
  const layers = [...ALWAYS, ...[...stylesFor(options.tags, options.allStyles)].flatMap(style => STYLE_LAYERS[style])];
  for (const layer of layers) {
    if (!has(layer.section)) continue;
    const source = layer.top ? topLine(byRole(layer.from)) : byRole(layer.from);
    for (const n of source) {
      if (layer.filter && !layer.filter.has(n.note)) continue;
      let note = n.note + (layer.transpose ?? 0);
      if (typeof layer.drumMap === "number") note = layer.drumMap;
      else if (layer.drumMap) {
        const mapped = layer.drumMap.get(n.note);
        if (mapped === undefined) continue;
        note = mapped;
      }
      add(layer.section, n, note, layer.velocity ?? 1);
    }
  }

  notes.sort((a, b) => a.timeMs - b.timeMs);
  return {
    source: options.source,
    title: options.title,
    durationMs: Math.max(0, ...notes.map(n => n.timeMs + n.durationMs)),
    notes,
    sections: [...new Set(notes.map(n => n.section))]
  };
}
