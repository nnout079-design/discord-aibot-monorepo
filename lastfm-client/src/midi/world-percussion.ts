export interface PercussionInstrument {
  id: string;
  name: string;
  region: string;
  midiNote: number;
  defaultVelocity: number;
}

export interface PercussionHit {
  instrument: string;
  note: number;
  velocity: number;
  durationMs: number;
}

export const WORLD_PERCUSSION: PercussionInstrument[] = [
  { id: "djembe", name: "Djembe", region: "West Africa", midiNote: 36, defaultVelocity: 112 },
  { id: "conga", name: "Conga", region: "Cuba", midiNote: 62, defaultVelocity: 108 },
  { id: "bongo", name: "Bongo", region: "Caribbean", midiNote: 60, defaultVelocity: 104 },
  { id: "tabla", name: "Tabla", region: "South Asia", midiNote: 64, defaultVelocity: 106 },
  { id: "darbuka", name: "Darbuka", region: "Middle East", midiNote: 63, defaultVelocity: 110 },
  { id: "taiko", name: "Taiko", region: "Japan", midiNote: 45, defaultVelocity: 120 },
  { id: "udu", name: "Udu", region: "West Africa", midiNote: 50, defaultVelocity: 100 },
  { id: "shekere", name: "Shekere", region: "West Africa", midiNote: 54, defaultVelocity: 96 }
];

export const PERCUSSION_PATTERNS: Record<string, string[]> = {
  afrobeat: ["djembe", "shekere", "conga", "djembe"],
  tabla: ["tabla", "tabla", "tabla", "tabla"],
  darbuka: ["darbuka", "darbuka", "darbuka", "darbuka"],
  taiko: ["taiko", "taiko", "taiko", "taiko"]
};

export function findInstrument(id: string): PercussionInstrument | undefined {
  return WORLD_PERCUSSION.find(instrument => instrument.id === id.toLowerCase());
}

export function createHit(id: string, velocity?: number, durationMs = 180): PercussionHit | undefined {
  const instrument = findInstrument(id);
  if (!instrument) return undefined;
  return {
    instrument: instrument.id,
    note: instrument.midiNote,
    velocity: Math.max(1, Math.min(127, velocity ?? instrument.defaultVelocity)),
    durationMs: Math.max(20, Math.min(5000, durationMs))
  };
}
