import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIGHTS, LightsConfig, validateLights } from "./lights/config";
import { renderUniverse } from "./lights/engine";
import { FixtureConfig, fixtureChannels } from "./lights/fixtures";
import { artnetPacket, enttecProPacket } from "./lights/output";
import { BLACKOUT, buildShow, GALAXY_PALETTE, hexToRgb, rigFrame, RigState } from "./lights/show";

const show = (accents: number[] = []) => buildShow(
  { beatMs: 500, beatsPerBar: 4, lights: { palette: ["#ff0000", "#00ff00", "#0000ff"], energy: 0.8 } },
  { countInAt: 10_000, startAt: 12_000, endAt: 30_000 },
  accents
);

test("rigFrame idles before the count-in, flashes white on count-in beats and blacks out at the end", () => {
  const s = show();
  assert.equal(rigFrame(s, 0, 9_000).dimmer, 0.12);
  const click = rigFrame(s, 0, 10_500);
  const between = rigFrame(s, 0, 10_900);
  assert.equal(click.w, 1);
  assert.ok(click.dimmer > 0.99 && between.dimmer < 0.3);
  assert.deepEqual(rigFrame(s, 1, 30_000), BLACKOUT);
});

test("rigFrame plays the two rigs a colour apart, mirrored, pulsing on the beat", () => {
  const s = show();
  const a = rigFrame(s, 0, 12_000);
  const b = rigFrame(s, 1, 12_000);
  assert.deepEqual([a.r, a.g, a.b], [1, 0, 0]);
  assert.deepEqual([b.r, b.g, b.b], [0, 1, 0]);
  assert.ok(a.dimmer > 0.99, "downbeat is full");
  assert.ok(rigFrame(s, 0, 12_500).dimmer < a.dimmer, "other beats are softer");
  const nextBar = rigFrame(s, 0, 14_000);
  assert.deepEqual([nextBar.r, nextBar.g, nextBar.b], [0, 1, 0], "energetic songs change colour every bar");
  const pa = rigFrame(s, 0, 13_000).pan - 0.5;
  const pb = rigFrame(s, 1, 13_000).pan - 0.5;
  assert.ok(Math.abs(pa + pb) < 1e-9 && pa !== 0, "pan sweeps are mirrored");
});

test("rigFrame strobes white for a beat when a section comes in", () => {
  const s = show([16_000]);
  const frames = [16_000, 16_050, 16_100, 16_150].map(t => rigFrame(s, 0, t));
  assert.ok(frames.every(f => f.w === 1));
  assert.deepEqual(frames.map(f => f.dimmer), [1, 0, 1, 0]);
  assert.equal(rigFrame(s, 0, 16_600).w, 0);
});

test("buildShow falls back to the galaxy palette", () => {
  const s = buildShow({ beatMs: 500, beatsPerBar: 4 }, { countInAt: 0, startAt: 2000, endAt: null });
  assert.deepEqual(s.palette, GALAXY_PALETTE.map(hexToRgb));
  assert.equal(s.energy, 0.6);
});

const red: RigState = { r: 1, g: 0, b: 0, w: 0, dimmer: 1, pan: 0.5, tilt: 0.25 };
const fixture = (profile: FixtureConfig["profile"], extra: Partial<FixtureConfig> = {}): FixtureConfig => ({ name: "x", profile, address: 1, rig: 0, ...extra });

test("Showtec Galaxy 360 channel maps", () => {
  assert.deepEqual(fixtureChannels(fixture("showtec-galaxy-360-18ch"), red), [128, 0, 64, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0]);
  const ten = fixtureChannels(fixture("showtec-galaxy-360-10ch", { invertPan: true, tiltRange: [0, 0.5] }), { ...red, pan: 0 });
  assert.deepEqual(ten, [255, 32, 0, 0, 255, 0, 10, 0, 0, 0]);
  assert.equal(fixtureChannels(fixture("showtec-galaxy-360-10ch"), { ...red, r: 0, b: 1 })[6], 143, "blue preset");
});

test("beamZ Galaxy5 channel maps", () => {
  const eleven = fixtureChannels(fixture("beamz-galaxy5-11ch"), { ...red, g: 1 });
  assert.deepEqual(eleven, [255, 0, 128, 64, 0, 0, 5, 0, 0, 125, 0]);
  const sixty = fixtureChannels(fixture("beamz-galaxy5-60ch"), red);
  assert.equal(sixty.length, 60);
  assert.deepEqual(sixty.slice(24, 36), [128, 64, 0, 255, 0, 255, 0, 0, 0, 0, 26, 0], "middle head");
  assert.ok(sixty[0] < sixty[12] && sixty[12] < sixty[24], "heads fan out");
});

test("renderUniverse places each fixture at its address and blacks out without a show", () => {
  const config: LightsConfig = { ...DEFAULT_LIGHTS, output: "log" };
  const s = show();
  const universe = renderUniverse(config, s, 12_000);
  assert.equal(universe.length, 512);
  assert.deepEqual([...universe.subarray(14, 18)], [255, 0, 0, 0], "Galaxy A red at 15-18");
  assert.deepEqual([...universe.subarray(32, 36)], [0, 255, 0, 0], "Galaxy B green at 33-36");
  assert.equal(renderUniverse(config, null, 12_000)[7], 0);
});

test("validateLights catches overlaps and out-of-range addresses", () => {
  assert.deepEqual(validateLights(DEFAULT_LIGHTS), []);
  const bad = validateLights({ ...DEFAULT_LIGHTS, fixtures: [fixture("rgbw-dimmer", { name: "A" }), fixture("rgb", { name: "B", address: 3 }), fixture("rgb", { name: "C", address: 511 })] });
  assert.deepEqual(bad, ["B overlaps A at channel 3", "C: address 511 + 3 channels does not fit in 1-512"]);
});

test("Art-Net and Enttec Pro packets", () => {
  const data = new Uint8Array(512);
  data[0] = 7;
  const art = artnetPacket(data, 0x0123, 9);
  assert.equal(art.subarray(0, 8).toString("latin1"), "Art-Net\0");
  assert.deepEqual([...art.subarray(8, 18)], [0x00, 0x50, 0, 14, 9, 0, 0x23, 0x01, 2, 0]);
  assert.equal(art.length, 18 + 512);
  assert.equal(art[18], 7);
  const pro = enttecProPacket(data);
  assert.deepEqual([...pro.subarray(0, 6)], [0x7e, 6, 1, 2, 0, 7]);
  assert.equal(pro[pro.length - 1], 0xe7);
  assert.equal(pro.length, 518);
});
