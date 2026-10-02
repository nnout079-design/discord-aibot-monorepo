import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateSong, parseKey } from "./arrange";
import { allTags } from "./arranger";
import { findSong, indexLibrary, normalize } from "./library";
import { orchestrate } from "./orchestrate";
import { Player, SongEntryEvent } from "./player";
import { DEFAULT_RIG, Rig, validateRig } from "./rig";
import { buildRouter } from "./router";
import { Score } from "./score";
import { parseStudioArgs } from "./studio";
import { channelPlan, entrances, scoreToMidi } from "./studio/midifile";
import { parseLoudness } from "./studio/remaster";
import { liveRigScript } from "./studio/reaper";
import { estimateBpm } from "./transcribe";
import { parseMidi } from "./song";

const NOTE_ON = 0x90;
const PROGRAM = 0xc0;
const CONTROL = 0xb0;

function recorder(name: string, log: { port: string; at: number; bytes: number[] }[], clock: { now: number }) {
  return { send: (bytes: number[]) => log.push({ port: name, at: clock.now, bytes }), close: () => {} };
}

function entry(over: Partial<SongEntryEvent> = {}): SongEntryEvent {
  return { type: "song-entry", sentAt: 0, countInAt: 10_000, startAt: 12_000, bpm: 120, beatMs: 500, barMs: 2000, beatsPerBar: 4, pattern: null, track: null, ...over };
}

const score: Score = {
  source: "generated", title: "t", durationMs: 4000, sections: ["violins1", "percussionA"],
  notes: [
    { section: "violins1", note: 30, velocity: 90, timeMs: 0, durationMs: 400 },
    { section: "percussionA", note: 36, velocity: 100, timeMs: 500, durationMs: 100 }
  ]
};

test("default rig validates and bad channels are rejected", () => {
  assert.equal(validateRig(DEFAULT_RIG), DEFAULT_RIG);
  const bad: Rig = { ...DEFAULT_RIG, sections: { ...DEFAULT_RIG.sections, violins1: { ...DEFAULT_RIG.sections.violins1, channel: 17 } } };
  assert.throws(() => validateRig(bad), /channel/);
});

test("router opens found ports and falls back to compact channels on the main output", () => {
  const log: { port: string; at: number; bytes: number[] }[] = [];
  const clock = { now: 0 };
  const main = recorder("main", log, clock);
  const orchestra = recorder("orchestra", log, clock);
  const router = buildRouter(DEFAULT_RIG, name => (name === DEFAULT_RIG.ports.orchestra ? orchestra : null), main, "GS");
  const violins = router.section("violins1")!;
  assert.equal(violins.out, orchestra);
  assert.equal(violins.channel, DEFAULT_RIG.sections.violins1.channel - 1);
  const drums = router.section("percussionA")!;
  assert.equal(drums.out, main);
  assert.equal(drums.channel, DEFAULT_RIG.sections.percussionA.compactChannel - 1);
  assert.equal(router.dj, null);
  assert.ok(router.report.some(line => line.includes("DJ booth off")));
});

test("player plays score notes per section with program changes, latency, DJ cue and full panic", () => {
  const log: { port: string; at: number; bytes: number[] }[] = [];
  const clock = { now: 0 };
  const main = recorder("main", log, clock);
  const orch = recorder("orchestra", log, clock);
  const dj = recorder("dj", log, clock);
  const rig: Rig = { ...DEFAULT_RIG, sections: { ...DEFAULT_RIG.sections, violins1: { ...DEFAULT_RIG.sections.violins1, latencyMs: 40 } } };
  const router = buildRouter(rig, name => (name === rig.ports.orchestra ? orch : name === rig.ports.dj ? dj : null), main, "GS");
  const player = new Player(router, { clock: false, now: () => clock.now, panicAll: true });
  player.load(entry(), 0, score);
  for (clock.now = 0; clock.now <= 12_600; clock.now++) player.tick();

  const violin = log.find(m => m.port === "orchestra" && (m.bytes[0] & 0xf0) === NOTE_ON && m.bytes[2] > 0)!;
  assert.equal(violin.at, 12_000 - 40);
  assert.ok(violin.bytes[1] >= DEFAULT_RIG.sections.violins1.range![0], "moved into the violin range");
  assert.ok(log.some(m => m.port === "orchestra" && m.bytes[0] === (PROGRAM | (DEFAULT_RIG.sections.violins1.channel - 1)) && m.at < 12_000));
  const drum = log.find(m => m.port === "main" && m.bytes[0] === (NOTE_ON | (DEFAULT_RIG.sections.percussionA.compactChannel - 1)))!;
  assert.equal(drum.at, 12_500);
  assert.ok(log.some(m => m.port === "dj" && m.bytes[0] === NOTE_ON && m.bytes[1] === 1 && m.at === 12_000));

  log.length = 0;
  player.stop();
  for (const port of ["main", "orchestra"]) {
    const offs = log.filter(m => m.port === port && (m.bytes[0] & 0xf0) === CONTROL && m.bytes[1] === 123);
    assert.equal(offs.length, 16, `all notes off on 16 channels of ${port}`);
  }
  assert.ok(log.some(m => m.port === "dj" && m.bytes[1] === 2));
});

test("library matches Artist/Title and Artist - Title files, preferring your own over Lakh", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "songs-"));
  fs.mkdirSync(path.join(root, "lakh", "Queen"), { recursive: true });
  fs.writeFileSync(path.join(root, "lakh", "Queen", "Bohemian Rhapsody.mid"), "");
  fs.writeFileSync(path.join(root, "Queen - Bohemian Rhapsody (Remastered 2011).mid"), "");
  const found = findSong(indexLibrary(root), "Queen", "Bohemian Rhapsody - Remastered 2011");
  assert.deepEqual(found.map(e => e.source), ["file", "lakh"]);
  assert.equal(normalize("The Beatles"), normalize("Beatles"));
});

test("generated song orchestrates onto the rig, round-trips through MIDI and gets style sections", () => {
  const song = generateSong({ bpm: 100, beatsPerBar: 4, durationMs: 30_000, tags: ["bangla"], seed: "A - B" });
  const s = orchestrate(song, DEFAULT_RIG, { tags: ["bangla"], source: "generated", title: "A - B" });
  assert.ok(s.sections.some(name => name.startsWith("bangla")));
  assert.ok(s.notes.every(n => DEFAULT_RIG.sections[n.section]));
  const back = parseMidi(Buffer.from(scoreToMidi(s, DEFAULT_RIG, 100)));
  assert.equal(back.parts.reduce((sum, p) => sum + p.notes.length, 0), s.notes.length);
  assert.equal(Math.round(back.bpm), 100);
  assert.ok(entrances(DEFAULT_RIG, s).length > 0);
});

test("channel plan puts drums on channel 10 and gives each program its own channel", () => {
  const plan = channelPlan(DEFAULT_RIG, ["percussionA", "violins1", "violins2", "trumpets"]);
  assert.equal(plan.get("percussionA")!.channel, 9);
  assert.equal(plan.get("violins1")!.channel, plan.get("violins2")!.channel);
  assert.notEqual(plan.get("violins1")!.channel, plan.get("trumpets")!.channel);
});

test("studio args, loudness parsing, Reaper script and tempo estimate", () => {
  const args = parseStudioArgs(["song=Queen - Bohemian Rhapsody", "studio=remaster,video", "bpm=72"]);
  assert.deepEqual([args.artist, args.title, args.bpm, [...args.modes]], ["Queen", "Bohemian Rhapsody", 72, ["remaster", "video"]]);
  assert.throws(() => parseStudioArgs([]), /Usage/);
  assert.throws(() => parseStudioArgs(["song=x - y", "studio=space"]), /Unknown studio/);
  assert.equal(parseLoudness('[Parsed_loudnorm_0]\n{\n"input_i" : "-20.1",\n"input_tp" : "-3.0",\n"input_lra" : "5",\n"input_thresh" : "-30",\n"target_offset" : "0.1"\n}').input_i, "-20.1");
  const lua = liveRigScript(DEFAULT_RIG);
  assert.ok(lua.includes("I_RECINPUT") && lua.includes(DEFAULT_RIG.sections.hardanger.label));
  const onsets = Array.from({ length: 64 }, (_, i) => i * 500 + (i % 3) * 3);
  assert.ok(Math.abs(estimateBpm(onsets) - 120) <= 1);
});

test("parseKey reads GetSongBPM keys and the generator follows key and danceability", () => {
  assert.deepEqual(parseKey("F♯m"), { root: 6, minor: true });
  assert.deepEqual(parseKey("Eb"), { root: 3, minor: false });
  assert.deepEqual(parseKey("C# minor"), { root: 1, minor: true });
  assert.equal(parseKey("unknown"), null);
  const song = generateSong({ bpm: 120, beatsPerBar: 4, durationMs: 40_000, tags: [], seed: "x", key: "A", danceability: 90 });
  const bass = song.parts.find(p => p.role === "bass")!;
  assert.equal(bass.notes[0].note % 12, 9, "bass starts on the tonic A");
  const kicks = (danceability: number) => generateSong({ bpm: 120, beatsPerBar: 4, durationMs: 40_000, tags: [], seed: "x", danceability })
    .parts.find(p => p.drums)!.notes.filter(n => n.note === 36).length;
  assert.ok(kicks(90) > kicks(0), "four on the floor for danceable songs");
});

test("allTags merges track, artist and genre tags without duplicates", () => {
  assert.deepEqual(allTags({ name: "n", artist: "a", tags: ["Rock", "90s"], artistTags: ["rock", "britpop"], genres: ["alternative"] }), ["Rock", "90s", "britpop", "alternative"]);
});
