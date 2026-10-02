import * as dotenv from "dotenv";
import { ClockSync } from "./clock";
import { subscribe } from "./events";
import { listOutputs, logOutput, openOutput } from "./midi";
import { LocalTimes, MidiOut, Player, SongEntryEvent } from "./player";

dotenv.config();

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

async function forward(event: object, local: LocalTimes | null, clockOffsetMs: number): Promise<void> {
  const url = process.env.ELECTRON_URL;
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, local: local && { ...local, clockOffsetMs } }),
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) log(`ELECTRON_URL returned ${response.status}`);
  } catch (error) {
    log(`ELECTRON_URL failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    const ports = listOutputs();
    console.log(ports.length ? ports.map((port, i) => `${i}: ${port}`).join("\n") : "No MIDI outputs found.");
    return;
  }

  const botUrl = (process.env.BOT_URL ?? "https://lastfm-client-bot.fly.dev").replace(/\/$/, "");
  const token = process.env.COMPANION_TOKEN;
  if (!token) throw new Error("COMPANION_TOKEN is missing. Run /companion in Discord and copy it into .env");

  const outputName = process.env.MIDI_OUTPUT ?? "loopMIDI";
  let out: MidiOut;
  if (outputName === "none") {
    out = logOutput(log);
    log("MIDI_OUTPUT=none: logging MIDI instead of sending it");
  } else {
    const opened = openOutput(outputName);
    out = opened.out;
    log(`MIDI output: ${opened.portName}`);
  }

  const clock = new ClockSync(botUrl);
  const sample = await clock.sync();
  log(`Clock synced to bot: offset ${sample.offsetMs.toFixed(1)} ms, round trip ${sample.rttMs.toFixed(0)} ms`);
  setInterval(() => clock.sync().catch(error => log(`Clock resync failed: ${error.message}`)), 5 * 60 * 1000);

  const player = new Player(out, { clock: process.env.MIDI_CLOCK !== "0" });
  setInterval(() => player.tick(), 1);

  const shutdown = () => {
    player.stop();
    out.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await subscribe(botUrl, token, (type, data) => {
    const event = JSON.parse(data) as SongEntryEvent | { type: "song-stop"; sentAt: number };
    if (event.type === "song-entry") {
      const local = player.load(event, clock.offsetMs);
      const inMs = Math.round(local.startAt - Date.now());
      const song = event.track ? `${event.track.artist} - ${event.track.name}` : "song entry";
      log(`Armed ${song}: ${event.bpm.toFixed(2)} BPM, downbeat in ${inMs} ms`);
      void forward(event, local, clock.offsetMs);
    } else if (event.type === "song-stop") {
      player.stop();
      log("Stopped");
      void forward(event, null, clock.offsetMs);
    }
  }, log);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
