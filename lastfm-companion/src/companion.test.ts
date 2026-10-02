import test from "node:test";
import assert from "node:assert/strict";
import { bestSample } from "./clock";
import { createSseParser } from "./events";
import { LATE_MS, Player, SongEntryEvent } from "./player";

function fakeOut() {
  const sent: { at: number; bytes: number[] }[] = [];
  let now = 0;
  return {
    sent,
    setNow: (t: number) => { now = t; },
    now: () => now,
    out: { send: (bytes: number[]) => sent.push({ at: now, bytes }), close: () => {} }
  };
}

function event(over: Partial<SongEntryEvent> = {}): SongEntryEvent {
  return {
    type: "song-entry", sentAt: 0, countInAt: 10_000, startAt: 12_000, bpm: 120, beatMs: 500, barMs: 2000, beatsPerBar: 4,
    pattern: null, track: null,
    midi: { channel: 9, hits: [0, 1, 2, 3].map(i => ({ instrument: "count-in", note: 37, velocity: 100, durationMs: 100, offsetMs: i * 500 })) },
    ...over
  };
}

function run(player: Player, fake: ReturnType<typeof fakeOut>, from: number, to: number) {
  for (let t = from; t <= to; t++) { fake.setNow(t); player.tick(); }
}

test("bestSample picks the shortest round trip", () => {
  assert.deepEqual(bestSample([{ offsetMs: 50, rttMs: 80 }, { offsetMs: 12, rttMs: 20 }, { offsetMs: 30, rttMs: 40 }]), { offsetMs: 12, rttMs: 20 });
});

test("SSE parser handles split chunks, comments and multiple events", () => {
  const got: [string, string][] = [];
  const parse = createSseParser((type, data) => got.push([type, data]));
  parse(": connected\n\nevent: song-en");
  parse("try\ndata: {\"a\":1}\n\n: ping\n\nevent: song-stop\r\ndata: {}\r\n\r\n");
  assert.deepEqual(got, [["song-entry", "{\"a\":1}"], ["song-stop", "{}"]]);
});

test("hits play at server time minus clock offset", () => {
  const fake = fakeOut();
  const player = new Player(fake.out, { clock: false, now: fake.now });
  const local = player.load(event(), 250);
  assert.equal(local.startAt, 11_750);
  run(player, fake, 9_000, 12_000);
  const noteOns = fake.sent.filter(m => m.bytes[0] === 0x99);
  assert.deepEqual(noteOns.map(m => m.at), [9_750, 10_250, 10_750, 11_250]);
  assert.deepEqual(fake.sent.filter(m => m.bytes[0] === 0x89).map(m => m.at), [9_850, 10_350, 10_850, 11_350]);
});

test("MIDI clock runs from the count-in and Start lands on the downbeat", () => {
  const fake = fakeOut();
  const player = new Player(fake.out, { clock: true, now: fake.now });
  player.load(event({ midi: { channel: 9, hits: [] } }), 0);
  run(player, fake, 9_990, 12_010);
  const clocks = fake.sent.filter(m => m.bytes[0] === 0xf8);
  assert.equal(clocks[0].at, 10_000);
  assert.equal(clocks.length, 97);
  const start = fake.sent.findIndex(m => m.bytes[0] === 0xfa);
  assert.equal(fake.sent[start].at, 12_000);
  assert.equal(fake.sent[start + 1].bytes[0], 0xf8);
});

test("late note-ons are dropped, stop sends Stop and all-notes-off", () => {
  const fake = fakeOut();
  const player = new Player(fake.out, { clock: true, now: fake.now });
  player.load(event(), 0);
  fake.setNow(10_000 + 500 + LATE_MS + 1);
  player.tick();
  assert.deepEqual(fake.sent.filter(m => m.bytes[0] === 0x99).map(m => m.at), []);
  player.stop();
  assert.deepEqual(fake.sent.slice(-2).map(m => m.bytes), [[0xfc], [0xb9, 123, 0]]);
  assert.equal(player.active, false);
});

test("playback stops at the end of the track", () => {
  const fake = fakeOut();
  const player = new Player(fake.out, { clock: true, now: fake.now });
  player.load(event({ track: { name: "s", artist: "a", durationMs: 1000, tags: [] } }), 0);
  run(player, fake, 10_000, 13_100);
  assert.equal(player.active, false);
  assert.equal(fake.sent.filter(m => m.bytes[0] === 0xfc).length, 1);
});
