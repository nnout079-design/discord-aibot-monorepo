import { Midi } from "@tonejs/midi";

export type Role = "drums" | "bass" | "melody" | "chords";

export interface PartNote {
  note: number;
  velocity: number;
  timeMs: number;
  durationMs: number;
}

export interface Part {
  name: string;
  program: number;
  drums: boolean;
  role?: Role;
  notes: PartNote[];
}

export interface Song {
  /** Tempo at the start of the song; 0 when unknown. */
  bpm: number;
  beatsPerBar: number;
  durationMs: number;
  parts: Part[];
}

const ROLE_BY_NAME: [RegExp, Role][] = [[/\bvocals?\b|\bmelody\b|\blead\b/i, "melody"], [/\bbass\b/i, "bass"], [/\bother\b|\bchords?\b/i, "chords"]];

export function parseMidi(data: ArrayLike<number> | ArrayBuffer): Song {
  const midi = new Midi(data);
  const parts: Part[] = midi.tracks
    .filter(track => track.notes.length > 0)
    .map(track => ({
      name: track.name,
      program: track.instrument.number,
      drums: track.channel === 9 || track.instrument.percussion,
      role: ROLE_BY_NAME.find(([pattern]) => pattern.test(track.name))?.[1],
      notes: track.notes.map(n => ({
        note: n.midi,
        velocity: Math.round(n.velocity * 127),
        timeMs: n.time * 1000,
        durationMs: n.duration * 1000
      }))
    }));
  const tempo = midi.header.tempos[0]?.bpm ?? 0;
  const beatsPerBar = midi.header.timeSignatures[0]?.timeSignature[0] ?? 4;
  const durationMs = Math.max(0, ...parts.flatMap(p => p.notes.map(n => n.timeMs + n.durationMs)));
  return { bpm: tempo, beatsPerBar, durationMs, parts };
}

// Scales every time in the song, e.g. to play it at the bot's tempo.
export function stretch(song: Song, ratio: number): Song {
  if (ratio === 1) return song;
  return {
    ...song,
    bpm: song.bpm / ratio,
    durationMs: song.durationMs * ratio,
    parts: song.parts.map(part => ({
      ...part,
      notes: part.notes.map(n => ({ ...n, timeMs: n.timeMs * ratio, durationMs: n.durationMs * ratio }))
    }))
  };
}
