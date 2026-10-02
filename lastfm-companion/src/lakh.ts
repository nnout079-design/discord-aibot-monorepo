import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { indexLibrary } from "./library";

const URL_CLEAN = "http://hog.ee.columbia.edu/craffel/lmd/clean_midi.tar.gz";

// Downloads the Lakh MIDI "clean" set (about 17,000 songs as Artist/Title.mid, CC-BY 4.0,
// https://colinraffel.com/projects/lmd/) into songs/lakh so the companion can play matching tracks.
async function main(): Promise<void> {
  const dir = path.join(process.env.SONGS_DIR ?? "songs", "lakh");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, "clean_midi"))) {
    console.log(`${dir}${path.sep}clean_midi already exists (${indexLibrary(path.dirname(dir)).filter(e => e.source === "lakh").length} songs).`);
    return;
  }
  const archive = path.join(dir, "clean_midi.tar.gz");
  console.log(`Downloading ${URL_CLEAN} ...`);
  const response = await fetch(URL_CLEAN);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let shown = -1;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : Math.floor(received / 1e7);
    if (pct !== shown) process.stdout.write(`\r${total ? `${pct}%` : `${(received / 1e6).toFixed(0)} MB`}   `);
    shown = pct;
  });
  await pipeline(body, fs.createWriteStream(archive));
  console.log("\nExtracting ...");
  const tar = spawnSync("tar", ["-xzf", "clean_midi.tar.gz"], { cwd: dir, stdio: "inherit" });
  if (tar.status !== 0) throw new Error("tar failed; extract songs/lakh/clean_midi.tar.gz with 7-Zip into songs/lakh");
  fs.rmSync(archive);
  console.log(`Done: ${indexLibrary(path.dirname(dir)).filter(e => e.source === "lakh").length} songs in ${dir}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
