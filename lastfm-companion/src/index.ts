import * as dotenv from "dotenv";
import { ClockSync } from "./clock";
import { subscribe } from "./events";
import { Arranger } from "./arranger";
import { loadLights } from "./lights/config";
import { LightEngine } from "./lights/engine";
import { openDmx } from "./lights/output";
import { buildShow, LightShow } from "./lights/show";
import { listOutputs, logOutput, openOutput, outputOpener } from "./midi";
import { LocalTimes, MidiOut, Player, SongEntryEvent } from "./player";
import { loadRig } from "./rig";
import { buildRouter, Router, singleRouter } from "./router";
import { Score } from "./score";
import { entrances } from "./studio/midifile";

dotenv.config();

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

function arrangementInfo(score: Score | null, labels: (section: string) => string) {
  return score && { source: score.source, title: score.title, durationMs: score.durationMs, sections: score.sections.map(labels) };
}

async function startLights(): Promise<LightEngine | null> {
  const file = process.env.LIGHTS_FILE ?? "lights.json";
  const config = loadLights(file);
  if (!config) return null;
  try {
    const out = await openDmx(config, log);
    if (!out) return null;
    log(`Galaxy lights: ${config.fixtures.map(f => f.name).join(", ")} on ${out.name}`);
    return new LightEngine(config, out);
  } catch (error) {
    log(`Galaxy lights off: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function forward(event: object, local: LocalTimes | null, clockOffsetMs: number, arrangement: object | null = null, show: LightShow | null = null): Promise<void> {
  const url = process.env.ELECTRON_URL;
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, local: local && { ...local, clockOffsetMs }, arrangement, show }),
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

  const rigOn = process.env.RIG !== "off";
  const rig = loadRig(process.env.RIG_FILE ?? "rig.json");
  let router: Router = singleRouter(out);
  if (rigOn) {
    const open = outputName === "none" ? () => null : outputOpener(log);
    router = buildRouter(rig, open, out, outputName === "none" ? "the log" : outputName);
    router.report.forEach(line => log(line));
  }
  const arranger = rigOn
    ? new Arranger(rig, {
      songsDir: process.env.SONGS_DIR ?? "songs",
      generate: process.env.GENERATE !== "0",
      allStyles: process.env.RIG_STYLE === "all",
      log
    })
    : null;
  const player = new Player(router, { clock: process.env.MIDI_CLOCK !== "0", panicAll: rigOn });
  setInterval(() => player.tick(), 1);
  const lights = await startLights();

  const shutdown = () => {
    player.stop();
    lights?.close();
    router.outs.forEach(o => o.close());
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await subscribe(botUrl, token, (type, data) => {
    const event = JSON.parse(data) as SongEntryEvent | { type: "song-stop"; sentAt: number };
    if (event.type === "song-entry") {
      let score: Score | null = null;
      try {
        score = arranger?.prepare(event) ?? null;
      } catch (error) {
        log(`Arrangement failed, playing the count-in only: ${error instanceof Error ? error.message : String(error)}`);
      }
      const local = player.load(event, clock.offsetMs, score);
      const inMs = Math.round(local.startAt - Date.now());
      const song = event.track ? `${event.track.artist} - ${event.track.name}` : "song entry";
      log(`Armed ${song}: ${event.bpm.toFixed(2)} BPM, downbeat in ${inMs} ms`);
      if (score) log(`${score.notes.length} notes across ${score.sections.length} sections, ${(score.durationMs / 1000).toFixed(0)} s`);
      const show = buildShow(event, local, score ? entrances(rig, score).map(e => local.startAt + e.timeMs) : []);
      lights?.load(show);
      void forward(event, local, clock.offsetMs, arrangementInfo(score, name => rig.sections[name]?.label ?? name), show);
    } else if (event.type === "song-stop") {
      player.stop();
      lights?.stop();
      log("Stopped");
      void forward(event, null, clock.offsetMs);
    }
  }, log);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
