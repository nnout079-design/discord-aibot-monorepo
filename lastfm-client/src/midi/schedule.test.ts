import test from "node:test";
import assert from "node:assert/strict";
import { schedulePattern } from "./schedule";
import { SIGMA } from "./humanize";

const hit = (instrument: string) => ({ instrument, note: 60, velocity: 100, durationMs: 180 });
const pat = ["tabla", "tabla", "conga", "tabla"].map(hit);

test("offsets sit on the 1/32 grid within 6 sigma", () => {
  const b = schedulePattern(pat, "s");
  b.hits.forEach((h, i) => assert.ok(Math.abs(h.offsetMs - i * b.stepMs) <= 6 * SIGMA * b.stepMs + 1e-9));
});

test("duration never overlaps the next step", () => {
  const b = schedulePattern(pat, "s");
  b.hits.forEach(h => assert.ok(h.durationMs < b.stepMs));
});

test("deterministic for same seed", () => {
  assert.deepEqual(schedulePattern(pat, "s"), schedulePattern(pat, "s"));
});

test("bpm in range and step ~54.5ms", () => {
  const b = schedulePattern(pat, "s");
  assert.ok(b.bpm >= 137.3 && b.bpm <= 137.7);
  assert.ok(Math.abs(b.stepMs - 54.5) < 0.3);
});