import * as dotenv from "dotenv";
import { parseSyncArgs } from "./args";

dotenv.config();

interface StartResponse {
  countInAt: number;
  startAt: number;
  bpm: number;
  beatsPerBar: number;
  pattern: string | null;
  track: { artist: string; name: string } | null;
  companions: number;
  now: number;
  error?: string;
}

async function main(): Promise<void> {
  const { action, body } = parseSyncArgs(process.argv.slice(2));
  const botUrl = (process.env.BOT_URL ?? "https://lastfm-client-bot.fly.dev").replace(/\/$/, "");
  const token = process.env.COMPANION_TOKEN;
  if (!token) throw new Error("COMPANION_TOKEN is missing from .env");

  const response = await fetch(`${botUrl}/sync/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({})) as Partial<StartResponse> & { stopped?: boolean };
  if (response.status === 401) throw new Error("The bot rejected COMPANION_TOKEN. Check the token in .env");
  if (!response.ok) throw new Error(result.error ?? `Bot returned ${response.status}`);

  if (action === "stop") {
    console.log(result.stopped ? "Cancelled before the downbeat." : "Stopped.");
    return;
  }
  const r = result as StartResponse;
  const seconds = (at: number) => ((at - r.now) / 1000).toFixed(1);
  const song = r.track ? `${r.track.artist} - ${r.track.name}` : r.pattern ?? "count-in only";
  console.log(`Armed ${song} at ${r.bpm.toFixed(2)} BPM: count-in in ${seconds(r.countInAt)} s, downbeat in ${seconds(r.startAt)} s.`);
  console.log(r.companions
    ? `${r.companions} companion(s) connected and playing it.`
    : "No companion is connected. Start one with `npm start` in another window first.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
