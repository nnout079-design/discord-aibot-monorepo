import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const STUDIO_DIR = process.env.STUDIO_DIR ?? "studio";
export const TOOLS_DIR = path.join(STUDIO_DIR, "tools");
export const SOUNDFONT = process.env.SOUNDFONT ?? path.join(STUDIO_DIR, "soundfonts", "MuseScore_General.sf3");

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

function findIn(dir: string, file: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === file.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findIn(full, file);
      if (found) return found;
    }
  }
  return null;
}

// FLUIDSYNTH / FFMPEG env, then studio/tools (from `npm run studio setup`), then PATH.
export function tool(name: "fluidsynth" | "ffmpeg"): string {
  const fromEnv = process.env[name.toUpperCase()];
  if (fromEnv) return fromEnv;
  return findIn(TOOLS_DIR, exe(name)) ?? name;
}

export function run(name: "fluidsynth" | "ffmpeg", args: string[], options: { cwd?: string; capture?: boolean } = {}): string {
  const result = spawnSync(tool(name), args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"]
  });
  if (result.error) throw new Error(`${name} not found. Run: npm run studio setup`);
  if (result.status !== 0) throw new Error(`${name} failed:\n${(result.stderr ?? "").split("\n").slice(-12).join("\n")}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
