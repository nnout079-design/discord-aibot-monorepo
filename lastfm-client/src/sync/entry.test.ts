import test from "node:test";
import assert from "node:assert/strict";
import { COUNT_IN_NOTE, entryHits, planEntry, songEntryEvent } from "./entry";
import { schedulePattern } from "../midi/schedule";

const now = 1_790_000_000_123;

test("startAt is bar-aligned and at least lead + one bar away", () => {
  const plan = planEntry(now, 8000, 120);
  assert.equal(plan.barMs, 2000);
  assert.equal(plan.startAt % plan.barMs, 0);
  assert.ok(plan.startAt >= now + 8000);
  assert.ok(plan.startAt - plan.barMs < now + 8000);
  assert.equal(plan.countInAt, plan.startAt - plan.barMs);
});

test("short lead still leaves a full count-in bar in the future", () => {
  const plan = planEntry(now, 0, 60);
  assert.ok(plan.countInAt >= now);
});

test("same inputs within one bar give the same downbeat", () => {
  const a = planEntry(now, 8000, 137.5);
  const b = planEntry(now + 10, 8000, 137.5);
  assert.equal(a.startAt, b.startAt);
});

test("count-in clicks land on the beats before the downbeat, pattern starts on it", () => {
  const plan = planEntry(now, 8000, 137.5, 4);
  const pattern = schedulePattern(["tabla", "conga"].map(instrument => ({ instrument, note: 60, velocity: 100, durationMs: 180 })), "s", 137.5).hits;
  const hits = entryHits(plan, pattern);
  const clicks = hits.filter(hit => hit.note === COUNT_IN_NOTE);
  assert.deepEqual(clicks.map(hit => hit.offsetMs), [0, 1, 2, 3].map(i => i * plan.beatMs));
  const entry = hits.slice(clicks.length);
  entry.forEach((hit, i) => assert.equal(hit.offsetMs, plan.barMs + pattern[i].offsetMs));
});

test("schedulePattern honours an explicit bpm", () => {
  const batch = schedulePattern([{ instrument: "tabla", note: 64, velocity: 100, durationMs: 180 }], "s", 100);
  assert.equal(batch.bpm, 100);
  assert.equal(batch.stepMs, 75);
});

test("song-entry event carries the plan, pattern and track", () => {
  const plan = planEntry(now, 8000, 120);
  const event = songEntryEvent(plan, "afrobeat", { name: "Song", artist: "Artist", tags: ["house"] }, now);
  assert.equal(event.type, "song-entry");
  assert.equal(event.startAt, plan.startAt);
  assert.equal(event.pattern, "afrobeat");
  assert.deepEqual(event.track?.tags, ["house"]);
});
