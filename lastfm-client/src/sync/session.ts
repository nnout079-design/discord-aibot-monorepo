import { createLastFmApi, LastFmApi } from "../lastfm/api";
import { triggerBatch } from "../midi/bridge";
import { pickBpm, stepSeconds } from "../midi/humanize";
import { schedulePattern } from "../midi/schedule";
import { createHit, PercussionHit, PERCUSSION_PATTERNS } from "../midi/world-percussion";
import { enrichTrack } from "./enrich";
import { companionHub, ControlHandler } from "./companion-hub";
import { EntryPlan, entryHits, notifyTargets, planEntry, songEntryEvent, SongStopEvent, TrackAttributes } from "./entry";

export interface SyncSession {
  plan: EntryPlan;
  pattern: string | null;
  track: TrackAttributes | null;
  abort: AbortController;
  timer: NodeJS.Timeout;
}

export interface EntryOptions {
  bpm?: number;
  leadMs?: number;
  beatsPerBar?: number;
  pattern?: string | null;
  track?: TrackAttributes | null;
  onDownbeat?: (session: SyncSession) => void;
}

const sessions = new Map<string, SyncSession>();

export async function nowPlaying(api: LastFmApi, username: string): Promise<TrackAttributes> {
  const [track] = await api.getRecentTracks(username, 1);
  if (!track || track["@attr"]?.nowplaying !== "true") throw new Error(`${username} is not scrobbling anything right now`);
  const base = await trackInfo(api, track.artist["#text"], track.name, false);
  return enrichTrack(api, { ...base, album: track.album?.["#text"] || base.album, url: track.url });
}

export async function trackInfo(api: LastFmApi, artist: string, name: string, enrich = true): Promise<TrackAttributes> {
  const info = await api.getTrackInfo(name, artist).catch(() => undefined);
  const track: TrackAttributes = {
    name: info?.name ?? name,
    artist: info?.artist ?? artist,
    album: info?.album,
    url: info?.url,
    durationMs: info?.durationMs,
    tags: info?.tags ?? [],
    mbid: info?.mbid,
    imageUrl: info?.imageUrl,
    summary: info?.summary,
    listeners: info?.listeners || undefined,
    playcount: info?.playcount || undefined
  };
  return enrich ? enrichTrack(api, track) : track;
}

export function getSession(key: string): SyncSession | undefined {
  return sessions.get(key);
}

function cancel(key: string): boolean {
  const session = sessions.get(key);
  if (!session) return false;
  session.abort.abort();
  clearTimeout(session.timer);
  sessions.delete(key);
  return true;
}

// Cancels the entry armed under `key` (or every armed entry) and always tells receivers to stop,
// so an entry that is already playing past its downbeat stops too. Returns whether one was still armed.
export async function stopEntry(key?: string): Promise<boolean> {
  const keys = key === undefined ? [...sessions.keys()] : [key];
  const cancelled = keys.map(cancel).some(Boolean);
  const event: SongStopEvent = { type: "song-stop", sentAt: Date.now() };
  companionHub.publish(event);
  await notifyTargets(event);
  return cancelled;
}

export async function armEntry(key: string, options: EntryOptions = {}): Promise<SyncSession> {
  cancel(key);
  const seed = process.env.HUMANIZE_SEED ?? "";
  const track = options.track ?? null;
  const bpm = options.bpm ?? track?.bpm ?? pickBpm(seed);
  const plan = planEntry(Date.now(), options.leadMs ?? 8000, bpm, options.beatsPerBar ?? track?.timeSig ?? 4);
  const pattern = options.pattern ?? null;
  const patternHits = pattern
    ? schedulePattern(PERCUSSION_PATTERNS[pattern].map(id => createHit(id)).filter((hit): hit is PercussionHit => hit !== undefined), seed, bpm).hits
    : [];

  const abort = new AbortController();
  const session: SyncSession = {
    plan,
    pattern,
    track,
    abort,
    timer: setTimeout(() => {
      sessions.delete(key);
      options.onDownbeat?.(session);
    }, Math.max(0, plan.startAt - Date.now()))
  };
  sessions.set(key, session);

  const hits = entryHits(plan, patternHits);
  triggerBatch({ bpm, stepMs: stepSeconds(bpm) * 1000, hits }, 9, { startAt: plan.countInAt, signal: abort.signal })
    .catch(error => console.error("Sync MIDI batch failed:", error));
  const event = songEntryEvent(plan, pattern, track, Date.now(), { channel: 9, hits });
  companionHub.publish(event);
  await notifyTargets(event);
  return session;
}

export interface StartRequest {
  pattern?: string;
  bpm?: number;
  lead?: number;
  beats?: number;
  username?: string;
  artist?: string;
  title?: string;
}

function inRange(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

export function parseStartRequest(body: unknown): StartRequest {
  if (body === null || body === undefined) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new Error("body must be a JSON object");
  const input = body as Record<string, unknown>;
  const { pattern, username } = input;
  if (pattern !== undefined && pattern !== null && (typeof pattern !== "string" || !(pattern in PERCUSSION_PATTERNS))) {
    throw new Error(`pattern must be one of: ${Object.keys(PERCUSSION_PATTERNS).join(", ")}`);
  }
  for (const [name, value] of Object.entries({ username, artist: input.artist, title: input.title })) {
    if (value !== undefined && value !== null && (typeof value !== "string" || value.length > 200)) throw new Error(`${name} must be a string`);
  }
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const artist = text(input.artist);
  const title = text(input.title);
  if (Boolean(artist) !== Boolean(title)) throw new Error("artist and title must be given together");
  return {
    pattern: typeof pattern === "string" ? pattern : undefined,
    bpm: inRange(input.bpm, "bpm", 40, 240),
    lead: inRange(input.lead, "lead", 2, 60),
    beats: inRange(input.beats, "beats", 2, 12),
    username: text(username),
    ...(artist && title ? { artist, title } : {})
  };
}

export const COMPANION_SESSION = "companion";

// Lets a PC companion arm or stop a song entry over the hub, without Discord.
export const companionControl: ControlHandler = async (action, body) => {
  if (action === "stop") return { status: 200, body: { stopped: await stopEntry() } };
  if (action === "now-playing") return companionNowPlaying(body);

  let request: StartRequest;
  try {
    request = parseStartRequest(body);
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
  let track: TrackAttributes | null = null;
  if (request.artist && request.title) {
    const api = createLastFmApi();
    track = api
      ? await trackInfo(api, request.artist, request.title)
      : await enrichTrack(null, { name: request.title, artist: request.artist, tags: [] });
  } else if (request.username) {
    const api = createLastFmApi();
    if (!api) return { status: 503, body: { error: "Last.fm API is not configured on the bot" } };
    try {
      track = await nowPlaying(api, request.username);
    } catch (error) {
      return { status: 422, body: { error: error instanceof Error ? error.message : "Could not read now playing from Last.fm" } };
    }
  }
  const { plan, pattern } = await armEntry(COMPANION_SESSION, {
    bpm: request.bpm,
    leadMs: request.lead === undefined ? undefined : request.lead * 1000,
    beatsPerBar: request.beats === undefined ? undefined : Math.round(request.beats),
    pattern: request.pattern,
    track
  });
  return {
    status: 200,
    body: { countInAt: plan.countInAt, startAt: plan.startAt, bpm: plan.bpm, beatsPerBar: plan.beatsPerBar, pattern, track, companions: companionHub.connected, now: Date.now() }
  };
};

async function companionNowPlaying(body: unknown): Promise<{ status: number; body: object }> {
  let request: StartRequest;
  try {
    request = parseStartRequest(body);
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
  if (!request.username && !request.artist) return { status: 400, body: { error: "username, or artist and title, is required" } };
  const api = createLastFmApi();
  if (!api && !request.artist) return { status: 503, body: { error: "Last.fm API is not configured on the bot" } };
  try {
    const track = request.artist && request.title
      ? api ? await trackInfo(api, request.artist, request.title) : await enrichTrack(null, { name: request.title, artist: request.artist, tags: [] })
      : await nowPlaying(api!, request.username!);
    return { status: 200, body: { track, bpm: track.bpm ?? null } };
  } catch (error) {
    return { status: 422, body: { error: error instanceof Error ? error.message : "Could not read now playing from Last.fm" } };
  }
}
