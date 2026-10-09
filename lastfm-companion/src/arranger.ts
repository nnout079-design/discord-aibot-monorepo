import fs from "node:fs";
import { generateSong } from "./arrange";
import { findSong, indexLibrary, LibraryEntry } from "./library";
import { orchestrate } from "./orchestrate";
import { SongEntryEvent, TrackInfo } from "./player";
import { Rig } from "./rig";
import { Score } from "./score";
import { parseMidi, Song, stretch } from "./song";

export interface ArrangerOptions {
  songsDir: string;
  generate: boolean;
  allStyles: boolean;
  log: (message: string) => void;
}

const DEFAULT_SONG_MS = 210000;

export function loadSongFile(entries: LibraryEntry[], durationMs?: number): { entry: LibraryEntry; song: Song } | null {
  let best: { entry: LibraryEntry; song: Song } | null = null;
  for (const entry of entries) {
    let song: Song;
    try {
      song = parseMidi(fs.readFileSync(entry.path));
    } catch {
      continue;
    }
    if (song.parts.length === 0) continue;
    if (!durationMs) return { entry, song };
    if (!best || Math.abs(song.durationMs - durationMs) < Math.abs(best.song.durationMs - durationMs)) best = { entry, song };
  }
  return best;
}

// Picks the notes for a Last.fm track: a local MIDI file if one matches, otherwise a generated arrangement.
// Track tags first, then the artist's Last.fm tags and GetSongBPM genres, without duplicates.
export function allTags(track: TrackInfo): string[] {
  const seen = new Set<string>();
  return [...track.tags, ...(track.artistTags ?? []), ...(track.genres ?? [])].filter(tag => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class Arranger {
  constructor(private rig: Rig, private options: ArrangerOptions) {}

  prepare(event: SongEntryEvent): Score | null {
    const track = event.track;
    if (!track) return null;
    const title = `${track.artist} - ${track.name}`;
    const tags = allTags(track);
    const found = loadSongFile(findSong(indexLibrary(this.options.songsDir), track.artist, track.name), track.durationMs);
    if (found) {
      const { entry, song } = found;
      const ratio = song.bpm > 0 && Math.abs(song.bpm - event.bpm) / event.bpm > 0.01 ? song.bpm / event.bpm : 1;
      this.options.log(`Playing ${entry.path} (${entry.source}${ratio === 1 ? "" : `, ${song.bpm.toFixed(1)} -> ${event.bpm} BPM`})`);
      return orchestrate(stretch(song, ratio), this.rig, { tags, allStyles: this.options.allStyles, source: entry.source, title });
    }
    if (!this.options.generate) return null;
    this.options.log(`No MIDI file for ${title}; generating an arrangement${track.key ? ` in ${track.key}` : ""} from tags: ${tags.slice(0, 6).join(", ") || "none"}`);
    const song = generateSong({
      bpm: event.bpm, beatsPerBar: event.beatsPerBar, durationMs: track.durationMs ?? DEFAULT_SONG_MS, tags, seed: title, key: track.key, danceability: track.danceability
    });
    return orchestrate(song, this.rig, { tags, allStyles: this.options.allStyles, source: "generated", title });
  }

  /** Tempo and meter of the best local file for a track, so a sync can start on the song's own grid. */
  tempoFor(artist: string, title: string, durationMs?: number): { bpm: number; beatsPerBar: number; path: string } | null {
    const found = loadSongFile(findSong(indexLibrary(this.options.songsDir), artist, title), durationMs);
    if (!found || found.song.bpm <= 0) return null;
    return { bpm: Math.round(found.song.bpm * 10) / 10, beatsPerBar: found.song.beatsPerBar, path: found.entry.path };
  }
}
