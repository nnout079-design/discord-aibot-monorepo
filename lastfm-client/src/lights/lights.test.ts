import test from "node:test";
import assert from "node:assert/strict";
import { planEntry } from "../sync/entry";
import { GALAXY_PALETTE, lightPlan } from "./palette";
import { CUE_BARS, galaxyCodes, galaxyCommands, hexToHsv, projectorCues, TuyaClient, tuyaSign } from "./tuya";

test("tuyaSign matches Tuya's documented token example", () => {
  assert.equal(tuyaSign({
    clientId: "1KAD46OrT9HafiKdsXeg",
    secret: "4OHBOnWOqaEC1mWXOpVL3yV50s0qGSRC",
    t: "1588925778000",
    nonce: "5138cc3a9033d69856923fd07b491173",
    method: "GET",
    url: "/v1.0/token?grant_type=1",
    body: "",
    signedHeaders: "area_id:29a33e8796834b1efa6\ncall_id:8afdb70ab2ed11eb85290242ac130003\n"
  }), "9E48A3E93B302EEECC803C7241985D0A34EB944F40FB573C7B5C2A82158AF13E");
});

test("lightPlan picks colours from tags and energy from danceability or tempo", () => {
  assert.deepEqual(lightPlan(null, 120).palette, GALAXY_PALETTE);
  assert.equal(lightPlan(null, 120).energy, 0.5);
  const techno = lightPlan({ name: "x", artist: "y", tags: ["Techno"], danceability: 85 }, 128);
  assert.equal(techno.palette[0], "#00e5ff");
  assert.equal(techno.energy, 0.85);
  assert.equal(lightPlan({ name: "x", artist: "y", tags: [], genres: ["rock"], danceability: 50, acousticness: 80 }, 100).energy, 0.3);
});

const STAR = [
  { code: "switch_led", type: "Boolean", values: "{}" },
  { code: "colour_data", type: "Json", values: JSON.stringify({ h: { min: 0, max: 360 }, s: { min: 0, max: 1000 }, v: { min: 0, max: 1000 } }) },
  { code: "star_work_mode", type: "Enum", values: JSON.stringify({ range: ["manual", "scene", "music"] }) },
  { code: "colour_switch", type: "Boolean", values: "{}" },
  { code: "laser_switch", type: "Boolean", values: "{}" },
  { code: "laser_bright", type: "Integer", values: JSON.stringify({ min: 10, max: 1000 }) },
  { code: "fan_switch", type: "Boolean", values: "{}" },
  { code: "fan_speed", type: "Integer", values: JSON.stringify({ min: 1, max: 100 }) }
];

test("galaxyCommands drives a star projector's nebula, lasers and motor", () => {
  const codes = galaxyCodes(STAR);
  assert.deepEqual(galaxyCommands(codes, { on: true, colour: "#ff0000", level: 0.5, speed: 1 }), [
    { code: "switch_led", value: true },
    { code: "star_work_mode", value: "manual" },
    { code: "colour_switch", value: true },
    { code: "colour_data", value: { h: 0, s: 1000, v: 500 } },
    { code: "laser_switch", value: true },
    { code: "laser_bright", value: 505 },
    { code: "fan_switch", value: true },
    { code: "fan_speed", value: 100 }
  ]);
  assert.deepEqual(galaxyCommands(codes, { on: false }), [{ code: "switch_led", value: false }]);
});

test("galaxyCommands falls back to a plain colour light", () => {
  const codes = galaxyCodes([
    { code: "switch_led", type: "Boolean", values: "{}" },
    { code: "work_mode", type: "Enum", values: JSON.stringify({ range: ["white", "colour", "scene"] }) },
    { code: "colour_data_v2", type: "Json", values: "{}" }
  ]);
  assert.deepEqual(galaxyCommands(codes, { on: true, colour: "#0000ff" }), [
    { code: "switch_led", value: true },
    { code: "work_mode", value: "colour" },
    { code: "colour_data_v2", value: { h: 240, s: 1000, v: 1000 } }
  ]);
  assert.deepEqual(hexToHsv("#00ff00"), { h: 120, s: 1, v: 1 });
});

test("projectorCues dims on the count-in, steps colours every few bars and switches off at the end", () => {
  const plan = planEntry(0, 2000, 120);
  const cues = projectorCues(plan, { palette: ["#111111", "#222222", "#333333"], energy: 0.7 }, plan.barMs * CUE_BARS * 2);
  assert.deepEqual(cues.slice(0, 2).map(c => [c.at, c.rig, c.state.level]), [[plan.countInAt, 0, 0.3], [plan.countInAt, 1, 0.3]]);
  const playing = cues.filter(c => c.state.level === 1);
  assert.deepEqual(playing.map(c => [c.at - plan.startAt, c.rig, c.state.colour]), [
    [0, 0, "#111111"], [0, 1, "#222222"], [8000, 0, "#222222"], [8000, 1, "#333333"]
  ]);
  assert.deepEqual(cues.slice(-2).map(c => [c.at - plan.startAt, c.state.on]), [[16000, false], [16000, false]]);
});

test("TuyaClient signs requests, caches the token and sends commands", async () => {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const result = url.includes("/token") ? { access_token: "tok", expire_time: 7200 } : true;
    return new Response(JSON.stringify({ success: true, result }));
  }) as typeof fetch;
  const client = new TuyaClient("id", "secret", "https://openapi.tuyaeu.com", fake);
  await client.send("dev1", [{ code: "switch_led", value: true }]);
  await client.send("dev1", [{ code: "switch_led", value: false }]);
  assert.deepEqual(calls.map(c => c.url), [
    "https://openapi.tuyaeu.com/v1.0/token?grant_type=1",
    "https://openapi.tuyaeu.com/v1.0/iot-03/devices/dev1/commands",
    "https://openapi.tuyaeu.com/v1.0/iot-03/devices/dev1/commands"
  ]);
  const [token, command] = calls;
  assert.equal(token.headers.access_token, undefined);
  assert.equal(command.headers.access_token, "tok");
  assert.equal(command.headers.sign, tuyaSign({
    clientId: "id", secret: "secret", t: command.headers.t, nonce: command.headers.nonce, method: "POST",
    url: "/v1.0/iot-03/devices/dev1/commands", body: command.body!, accessToken: "tok"
  }));
  assert.deepEqual(JSON.parse(command.body!), { commands: [{ code: "switch_led", value: true }] });
});

test("TuyaClient.fromEnv needs both keys", () => {
  assert.equal(TuyaClient.fromEnv({}), null);
  assert.ok(TuyaClient.fromEnv({ TUYA_ACCESS_ID: "a", TUYA_ACCESS_SECRET: "b", TUYA_REGION: "us" }));
  assert.throws(() => TuyaClient.fromEnv({ TUYA_ACCESS_ID: "a", TUYA_ACCESS_SECRET: "b", TUYA_REGION: "mars" }), /TUYA_REGION/);
});
