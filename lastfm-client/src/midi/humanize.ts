import { createHash } from "node:crypto";

export const SUBDIV = 32;
export const SIGMA = 0.003;                 // fraction of one 1/32 step
export const BPM_MIN = 137.3, BPM_MAX = 137.7;

function rng(seed: string) {                // mulberry32
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) =>
  Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

export const pickBpm = (seed: string) => BPM_MIN + rng(`${seed}:bpm`)() * (BPM_MAX - BPM_MIN);
export const stepSeconds = (bpm: number) => (60 / bpm) * (4 / SUBDIV);

export function makeHumanizer(instrumentId: string, seed = process.env.HUMANIZE_SEED ?? "", bpm = pickBpm(seed)) {
  const r = rng(`${seed}:${instrumentId}`);
  const step = stepSeconds(bpm);
  return (timeSec: number) => Math.round(timeSec / step) * step + gauss(r) * SIGMA * step;
}