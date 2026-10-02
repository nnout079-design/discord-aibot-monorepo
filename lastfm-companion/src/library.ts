import fs from "node:fs";
import path from "node:path";
import { ScoreSource } from "./score";

export interface LibraryEntry {
  path: string;
  artist: string;
  title: string;
  source: Exclude<ScoreSource, "generated">;
}

const MIDI_EXT = /\.midi?$/i;
const SOURCE_RANK: Record<LibraryEntry["source"], number> = { file: 0, transcribed: 1, lakh: 2 };

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s(feat|ft|featuring)\.?\s.*$/, " ")
    .replace(/\s-\s.*(remaster|version|edit|mix|live).*$/, " ")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isDirectory());
    if (isDir) walk(full, out);
    else if (MIDI_EXT.test(entry.name)) out.push(full);
  }
}

// Files are named "Artist - Title.mid" anywhere under the songs folder, or Artist/Title.mid.
// The Lakh clean set (songs/lakh/clean_midi/Artist/Title.N.mid) and npm run transcribe output (songs/transcribed) are recognised too.
export function indexLibrary(root: string): LibraryEntry[] {
  const files: string[] = [];
  walk(root, files);
  return files.map(file => {
    const rel = path.relative(root, file).split(path.sep);
    const base = path.basename(file).replace(MIDI_EXT, "");
    const source: LibraryEntry["source"] = rel[0] === "lakh" ? "lakh" : rel[0] === "transcribed" ? "transcribed" : "file";
    if (source === "lakh") return { path: file, artist: rel[rel.length - 2] ?? "", title: base.replace(/\.\d+$/, ""), source };
    const dash = base.indexOf(" - ");
    if (dash > 0) return { path: file, artist: base.slice(0, dash), title: base.slice(dash + 3), source };
    return { path: file, artist: rel.length > 1 ? rel[rel.length - 2] : "", title: base, source };
  });
}

export function findSong(entries: LibraryEntry[], artist: string, title: string): LibraryEntry[] {
  const a = normalize(artist);
  const t = normalize(title);
  return entries
    .filter(entry => normalize(entry.title) === t && normalize(entry.artist) === a)
    .sort((x, y) => SOURCE_RANK[x.source] - SOURCE_RANK[y.source]);
}
