import fs from "node:fs";

export interface SectionConfig {
  label: string;
  group: string;
  port: string;
  /** 1-16 */
  channel: number;
  /** General MIDI program 0-127, sent before the song starts. Omitted for drum sections. */
  program?: number;
  /** GM drum-note section (notes are drum hits, not pitches). */
  drums?: boolean;
  /** Playable note range; pitched notes are moved by octaves into it. */
  range?: [number, number];
  /** Sent this many ms early to make up for a slow instrument. */
  latencyMs?: number;
  /** Channel used when the section's port is missing and everything shares one MIDI output. */
  compactChannel: number;
}

export interface Rig {
  /** Port key -> part of the MIDI output name (case-insensitive match). */
  ports: Record<string, string>;
  sections: Record<string, SectionConfig>;
  /** Port key used for the count-in, MIDI clock and Start/Stop. */
  mainPort: string;
  /** Port key for the DJ booth (Mixxx), or omitted for none. */
  djPort?: string;
}

// When everything shares one General MIDI synth, each compact channel plays one sound.
export const COMPACT_PROGRAMS: Record<number, number | null> = {
  1: 33, 2: 81, 3: 90, 4: 48, 5: 61, 6: 73, 7: 52, 8: 19,
  9: 46, 10: null, 11: 104, 12: 21, 13: 110, 14: 60, 15: 47, 16: 116
};

type Def = [label: string, group: string, port: string, channel: number, program: number | "drums", range: [number, number] | null, compact: number];

const DEFS: Record<string, Def> = {
  percussionA: ["Percussion set A", "Percussion", "main", 10, "drums", null, 10],
  percussionB: ["Percussion set B", "Percussion", "main", 11, "drums", null, 10],
  bassA: ["Bass rack A", "Bass racks", "main", 1, 38, [28, 55], 1],
  bassB: ["Bass rack B", "Bass racks", "main", 2, 33, [24, 48], 1],
  moogA: ["Moog A", "Moog synths", "main", 3, 81, [48, 84], 2],
  moogB: ["Moog B", "Moog synths", "main", 4, 90, [48, 84], 3],

  violins1: ["1st violins", "Classical orchestra", "orchestra", 1, 40, [55, 100], 4],
  violins2: ["2nd violins", "Classical orchestra", "orchestra", 2, 40, [55, 93], 4],
  violas: ["Violas", "Classical orchestra", "orchestra", 3, 41, [48, 84], 4],
  cellos: ["Cellos", "Classical orchestra", "orchestra", 4, 42, [36, 72], 4],
  basses: ["Double basses", "Classical orchestra", "orchestra", 5, 43, [28, 55], 4],
  flutes: ["Flutes", "Classical orchestra", "orchestra", 6, 73, [60, 96], 6],
  oboes: ["Oboes", "Classical orchestra", "orchestra", 7, 68, [58, 91], 6],
  clarinets: ["Clarinets", "Classical orchestra", "orchestra", 8, 71, [50, 91], 6],
  bassoons: ["Bassoons", "Classical orchestra", "orchestra", 9, 70, [34, 72], 6],
  horns: ["Horns", "Classical orchestra", "orchestra", 10, 60, [41, 77], 5],
  trumpets: ["Trumpets", "Classical orchestra", "orchestra", 11, 56, [55, 82], 5],
  trombones: ["Trombones", "Classical orchestra", "orchestra", 12, 57, [40, 72], 5],
  tuba: ["Tuba", "Classical orchestra", "orchestra", 13, 58, [28, 58], 5],
  timpani: ["Timpani", "Classical orchestra", "orchestra", 14, 47, [40, 57], 15],
  harp: ["Harp", "Classical orchestra", "orchestra", 15, 46, [24, 103], 9],

  choirSoprano: ["Choir sopranos", "Choir", "choir", 1, 52, [60, 81], 7],
  choirAlto: ["Choir altos", "Choir", "choir", 2, 52, [53, 74], 7],
  choirTenor: ["Choir tenors", "Choir", "choir", 3, 52, [48, 69], 7],
  choirBass: ["Choir basses", "Choir", "choir", 4, 52, [40, 62], 7],

  organGreat: ["Organ great", "Organ", "organ", 1, 19, [36, 96], 8],
  organSwell: ["Organ swell", "Organ", "organ", 2, 19, [36, 96], 8],
  organPedal: ["Organ pedal", "Organ", "organ", 3, 19, [24, 55], 8],

  banglaSitar: ["Sitar", "Bangla orchestra", "world", 1, 104, [48, 84], 11],
  banglaDotara: ["Dotara", "Bangla orchestra", "world", 2, 105, [48, 79], 11],
  banglaEsraj: ["Esraj", "Bangla orchestra", "world", 3, 110, [55, 91], 13],
  banglaBansuri: ["Bansuri", "Bangla orchestra", "world", 4, 73, [60, 93], 6],
  banglaDhol: ["Dhol", "Bangla orchestra", "world", 5, "drums", null, 10],
  banglaTabla: ["Tabla", "Bangla orchestra", "world", 6, "drums", null, 10],

  balkanBrass: ["Balkan brass", "Balkan orchestra", "world", 7, 61, [40, 80], 5],
  balkanClarinet: ["Balkan clarinet", "Balkan orchestra", "world", 8, 71, [50, 91], 6],
  balkanAccordion: ["Accordion", "Balkan orchestra", "world", 9, 21, [41, 89], 12],
  balkanGaida: ["Gaida", "Balkan orchestra", "world", 11, 109, [60, 84], 12],
  balkanTapan: ["Tapan", "Balkan orchestra", "world", 12, "drums", null, 10],

  taikoOdaiko: ["Odaiko", "Taiko orchestra", "epic", 1, 116, [24, 48], 16],
  taikoShime: ["Shime-daiko", "Taiko orchestra", "epic", 2, 116, [60, 84], 16],
  taikoChappa: ["Chappa", "Taiko orchestra", "epic", 3, "drums", null, 10],

  romanCornu: ["Cornu", "Roman imperial orchestra", "epic", 4, 60, [34, 65], 14],
  romanBuccina: ["Buccina", "Roman imperial orchestra", "epic", 5, 60, [48, 72], 14],
  romanTuba: ["Roman tuba", "Roman imperial orchestra", "epic", 6, 58, [28, 58], 14],
  romanWarDrums: ["War drums", "Roman imperial orchestra", "epic", 7, 116, [24, 48], 16],

  hardanger: ["Hardanger fiddle", "Hardanger fiddle", "epic", 8, 110, [55, 96], 13]
};

export const DEFAULT_RIG: Rig = {
  ports: {
    main: "Rig Main",
    orchestra: "Rig Orchestra",
    choir: "Rig Choir",
    organ: "Rig Organ",
    world: "Rig World",
    epic: "Rig Epic",
    dj: "Rig DJ"
  },
  mainPort: "main",
  djPort: "dj",
  sections: Object.fromEntries(Object.entries(DEFS).map(([name, [label, group, port, channel, program, range, compactChannel]]) => [name, {
    label,
    group,
    port,
    channel,
    ...(program === "drums" ? { drums: true } : { program }),
    ...(range && { range }),
    compactChannel
  }]))
};

export function validateRig(rig: Rig): Rig {
  if (!rig.ports?.[rig.mainPort]) throw new Error(`rig.json: mainPort "${rig.mainPort}" is not in ports`);
  for (const [name, section] of Object.entries(rig.sections ?? {})) {
    if (!rig.ports[section.port]) throw new Error(`rig.json: section ${name} uses unknown port "${section.port}"`);
    for (const [key, value] of [["channel", section.channel], ["compactChannel", section.compactChannel]] as const) {
      if (!Number.isInteger(value) || value < 1 || value > 16) throw new Error(`rig.json: section ${name} ${key} must be 1-16`);
    }
    if (section.program !== undefined && (!Number.isInteger(section.program) || section.program < 0 || section.program > 127)) {
      throw new Error(`rig.json: section ${name} program must be 0-127`);
    }
    if (section.range && !(section.range[0] >= 0 && section.range[1] <= 127 && section.range[1] - section.range[0] >= 11)) {
      throw new Error(`rig.json: section ${name} range must span at least an octave within 0-127`);
    }
  }
  return rig;
}

// rig.json, when present, overrides the built-in rig section by section.
export function loadRig(path = "rig.json"): Rig {
  if (!fs.existsSync(path)) return DEFAULT_RIG;
  const custom = JSON.parse(fs.readFileSync(path, "utf8")) as Partial<Rig>;
  return validateRig({
    ports: { ...DEFAULT_RIG.ports, ...custom.ports },
    mainPort: custom.mainPort ?? DEFAULT_RIG.mainPort,
    djPort: custom.djPort === undefined ? DEFAULT_RIG.djPort : custom.djPort,
    sections: Object.fromEntries(
      Object.entries({ ...DEFAULT_RIG.sections, ...custom.sections })
        .filter(([, section]) => section !== null)
        .map(([name, section]) => [name, { ...DEFAULT_RIG.sections[name], ...section }])
    )
  });
}
