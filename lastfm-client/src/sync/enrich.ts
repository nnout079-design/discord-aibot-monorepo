import { LastFmApi } from "../lastfm/api";
import { lookupSong } from "./bpm";
import { TrackAttributes } from "./entry";

const USER_AGENT = "lastfm-client-bot/1.0 (https://github.com/nnout079-design/discord-aibot-monorepo)";

// Song length from MusicBrainz (no key needed), by MBID or by artist and title.
export async function musicBrainzLength(track: Pick<TrackAttributes, "artist" | "name" | "mbid">, fetchImpl: typeof fetch = fetch): Promise<number | undefined> {
  const quote = (text: string) => `"${text.replace(/["\\]/g, "")}"`;
  const url = track.mbid
    ? `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(track.mbid)}?fmt=json`
    : `https://musicbrainz.org/ws/2/recording?fmt=json&limit=1&query=${encodeURIComponent(`recording:${quote(track.name)} AND artist:${quote(track.artist)}`)}`;
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return undefined;
    const json = await response.json() as { length?: number; recordings?: { length?: number }[] };
    const length = json.length ?? json.recordings?.[0]?.length;
    return typeof length === "number" && length > 0 ? length : undefined;
  } catch {
    return undefined;
  }
}

// Adds artist info (Last.fm), tempo/key/feel (GetSongBPM) and, if missing, length (MusicBrainz).
// Each source is optional; a failure just leaves its fields out.
export async function enrichTrack(api: LastFmApi | null, track: TrackAttributes, fetchImpl: typeof fetch = fetch): Promise<TrackAttributes> {
  const [artist, facts, length] = await Promise.all([
    api?.getArtistInfo(track.artist).catch(() => undefined),
    lookupSong(track, fetchImpl),
    track.durationMs ? undefined : musicBrainzLength(track, fetchImpl)
  ]);
  const enriched: TrackAttributes = { ...track, durationMs: track.durationMs ?? length };
  if (artist) {
    enriched.artistTags = artist.tags.slice(0, 10);
    enriched.similarArtists = artist.similar.slice(0, 5);
    enriched.summary ??= artist.summary;
  }
  if (facts) Object.assign(enriched, Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)));
  return enriched;
}
