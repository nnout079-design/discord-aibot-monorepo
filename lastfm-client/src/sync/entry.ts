import { ScheduledHit } from "../midi/schedule";

export const COUNT_IN_NOTE = 37;

export interface EntryPlan {
  bpm: number;
  beatMs: number;
  barMs: number;
  beatsPerBar: number;
  countInAt: number;
  startAt: number;
}

export interface TrackAttributes {
  name: string;
  artist: string;
  album?: string;
  url?: string;
  durationMs?: number;
  tags: string[];
  mbid?: string;
  imageUrl?: string;
  summary?: string;
  listeners?: number;
  playcount?: number;
  artistTags?: string[];
  similarArtists?: string[];
  bpm?: number;
  timeSig?: number;
  key?: string;
  openKey?: string;
  danceability?: number;
  acousticness?: number;
  genres?: string[];
  year?: number;
}

export interface SongEntryEvent {
  type: "song-entry";
  sentAt: number;
  countInAt: number;
  startAt: number;
  bpm: number;
  beatMs: number;
  barMs: number;
  beatsPerBar: number;
  pattern: string | null;
  track: TrackAttributes | null;
  midi?: { channel: number; hits: ScheduledHit[] };
}

export interface SongStopEvent {
  type: "song-stop";
  sentAt: number;
}

// startAt is the first epoch-aligned bar line at least one full count-in bar after now + leadMs,
// so every receiver that schedules against wall-clock time lands on the same downbeat.
export function planEntry(now: number, leadMs: number, bpm: number, beatsPerBar = 4): EntryPlan {
  const beatMs = 60000 / bpm;
  const barMs = beatMs * beatsPerBar;
  const startAt = Math.ceil((now + Math.max(leadMs, barMs)) / barMs) * barMs;
  return { bpm, beatMs, barMs, beatsPerBar, countInAt: startAt - barMs, startAt };
}

// Offsets are relative to plan.countInAt: one bar of count-in clicks, then the pattern from the downbeat.
export function entryHits(plan: EntryPlan, pattern: ScheduledHit[] = []): ScheduledHit[] {
  const clickMs = Math.max(20, Math.min(100, Math.floor(plan.beatMs * 0.5)));
  const clicks: ScheduledHit[] = Array.from({ length: plan.beatsPerBar }, (_, i) => ({
    instrument: "count-in",
    note: COUNT_IN_NOTE,
    velocity: i === 0 ? 110 : 90,
    durationMs: clickMs,
    offsetMs: i * plan.beatMs
  }));
  return [...clicks, ...pattern.map(hit => ({ ...hit, offsetMs: plan.barMs + hit.offsetMs }))];
}

export function songEntryEvent(
  plan: EntryPlan,
  pattern: string | null,
  track: TrackAttributes | null,
  sentAt = Date.now(),
  midi?: SongEntryEvent["midi"]
): SongEntryEvent {
  return { type: "song-entry", sentAt, ...plan, pattern, track, ...(midi && { midi }) };
}

export async function notifyTargets(event: SongEntryEvent | SongStopEvent, targets = process.env.SYNC_TARGETS ?? ""): Promise<void> {
  const urls = targets.split(",").map(url => url.trim()).filter(Boolean);
  if (urls.length === 0) {
    console.log("Sync event", JSON.stringify(event));
    return;
  }
  const results = await Promise.allSettled(urls.map(async url => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  }));
  results.forEach(result => {
    if (result.status === "rejected") console.error("Sync target failed:", result.reason);
  });
}
