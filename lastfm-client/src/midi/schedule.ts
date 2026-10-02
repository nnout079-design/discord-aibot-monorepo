import { makeHumanizer, pickBpm, stepSeconds } from "./humanize";
import { PercussionHit } from "./world-percussion";

export interface ScheduledHit extends PercussionHit { offsetMs: number }
export interface Batch { bpm: number; stepMs: number; hits: ScheduledHit[] }

export function schedulePattern(hits: PercussionHit[], seed = process.env.HUMANIZE_SEED ?? "", bpm = pickBpm(seed)): Batch {
  const step = stepSeconds(bpm);
  const stepMs = step * 1000;
  const humanizers = new Map<string, ReturnType<typeof makeHumanizer>>();
  const out = hits.map((hit, i) => {
    let h = humanizers.get(hit.instrument);
    if (!h) humanizers.set(hit.instrument, (h = makeHumanizer(hit.instrument, seed, bpm)));
    return {
      ...hit,
      durationMs: Math.min(hit.durationMs, Math.floor(stepMs * 0.9)),
      offsetMs: Math.max(0, h(i * step) * 1000)
    };
  });
  return { bpm, stepMs, hits: out };
}