export type ScoreSource = "file" | "lakh" | "transcribed" | "generated";

export interface ScoreNote {
  section: string;
  note: number;
  velocity: number;
  /** ms after the downbeat (startAt) */
  timeMs: number;
  durationMs: number;
}

export interface Score {
  source: ScoreSource;
  title: string;
  /** ms from the downbeat to the end of the last note */
  durationMs: number;
  notes: ScoreNote[];
  sections: string[];
}

export function moveIntoRange(note: number, range?: [number, number]): number {
  if (!range) return note;
  let n = note;
  while (n < range[0]) n += 12;
  while (n > range[1]) n -= 12;
  return n < range[0] ? range[0] : n;
}
