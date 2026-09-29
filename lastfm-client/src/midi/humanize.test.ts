import test from "node:test";
import assert from "node:assert/strict";
import { makeHumanizer, pickBpm, stepSeconds, BPM_MIN, BPM_MAX, SIGMA } from "./humanize";

test("bpm within range", () => {
  for (const s of ["", "a", "b", "seed42"]) {
    const b = pickBpm(s);
    assert.ok(b >= BPM_MIN && b <= BPM_MAX);
  }
});

test("deterministic per seed+instrument", () => {
  const a = makeHumanizer("djembe", "s"), b = makeHumanizer("djembe", "s");
  for (let i = 0; i < 50; i++) assert.equal(a(i * 0.05), b(i * 0.05));
});

test("instruments have independent streams", () => {
  const a = makeHumanizer("djembe", "s"), b = makeHumanizer("conga", "s");
  assert.notEqual(a(1), b(1));
});

test("stays within 6 sigma of the grid", () => {
  const bpm = pickBpm("s"), step = stepSeconds(bpm), h = makeHumanizer("taiko", "s", bpm);
  for (let k = 0; k < 2000; k++) assert.ok(Math.abs(h(k * step) - k * step) < 6 * SIGMA * step);
});

test("sigma is ~0.3% of a step", () => {
  const bpm = pickBpm("s"), step = stepSeconds(bpm), h = makeHumanizer("udu", "s", bpm);
  const n = 5000; let sq = 0;
  for (let k = 0; k < n; k++) sq += (h(k * step) - k * step) ** 2;
  const sd = Math.sqrt(sq / n);
  assert.ok(Math.abs(sd / (SIGMA * step) - 1) < 0.1);
});