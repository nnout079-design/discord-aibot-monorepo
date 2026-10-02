import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SOUNDFONT, tool, TOOLS_DIR } from "./tools";

// MuseScore General (MIT): a complete General MIDI soundfont, so every rig section has a real sound.
const SOUNDFONT_URL = "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3";
const FLUIDSYNTH_WIN = "https://github.com/FluidSynth/fluidsynth/releases/download/v2.6.1/fluidsynth-v2.6.1-win10-x64-cpp11.zip";
const FFMPEG_WIN = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

async function download(url: string, file: string): Promise<void> {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), fs.createWriteStream(file));
}

function works(name: "fluidsynth" | "ffmpeg"): boolean {
  const result = spawnSync(tool(name), [name === "ffmpeg" ? "-version" : "--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

async function unzipTool(url: string, name: string): Promise<void> {
  const zip = path.join(TOOLS_DIR, `${name}.zip`);
  await download(url, zip);
  const dir = path.join(TOOLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const tar = spawnSync("tar", ["-xf", path.resolve(zip), "-C", path.resolve(dir)], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`Could not extract ${zip}`);
  fs.rmSync(zip);
}

export async function setup(): Promise<void> {
  if (fs.existsSync(SOUNDFONT)) console.log(`Soundfont: ${SOUNDFONT}`);
  else await download(SOUNDFONT_URL, SOUNDFONT);

  for (const [name, url] of [["fluidsynth", FLUIDSYNTH_WIN], ["ffmpeg", FFMPEG_WIN]] as const) {
    if (works(name)) {
      console.log(`${name}: ${tool(name)}`);
    } else if (process.platform === "win32") {
      await unzipTool(url, name);
      if (!works(name)) throw new Error(`${name} still doesn't run after download`);
      console.log(`${name}: ${tool(name)}`);
    } else {
      throw new Error(`${name} is missing. Install it (e.g. sudo apt install ${name} or brew install ${name}) and run setup again`);
    }
  }
  console.log("Studio ready. Try: npm run studio \"song=Queen - Bohemian Rhapsody\"");
}
