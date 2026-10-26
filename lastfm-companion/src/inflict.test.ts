import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnose, parseStudioArgs } from "./studio";
import { audioCodecArgs, collisionWindow, DEFAULT_DIAGNOSIS, inflictFilter } from "./studio/inflict";

test("inflict args", () => {
  const args = parseStudioArgs(["inflict", "song=Queen - Bohemian Rhapsody", "videos=a.mp4,b.mp4", "video=c.mov", "audio=song.flac", "describe=rain|fire", "blend=screen", "rate=two_bars", "strobe=1"]);
  assert.equal(args.command, "inflict");
  assert.deepEqual(args.videos, ["a.mp4", "b.mp4", "c.mov"]);
  assert.deepEqual([args.audio, args.describe, args.blend, args.rate, args.strobe, args.originalSound], ["song.flac", ["rain", "fire"], "screen", "two_bars", true, true]);
  assert.throws(() => parseStudioArgs(["inflict", "videos=a.mp4"]), /Usage: npm run studio inflict/);
  assert.throws(() => parseStudioArgs(["inflict", "videos=a.mp4,b.mp4", "original=0"]), /needs song= or user=/);
  assert.throws(() => parseStudioArgs(["inflict", "videos=a.mp4,b.mp4", "blend=multiply"]), /blend must be one of/);
  assert.equal(parseStudioArgs(["inflict", "videos=a.mp4,b.mp4"]).originalSound, true);
});

test("studio diagnosis needs a username when the bot token is configured", async () => {
  const previousToken = process.env.COMPANION_TOKEN;
  process.env.COMPANION_TOKEN = "test-token";
  let called = false;
  const args = parseStudioArgs(["inflict", "song=Artist - Title", "videos=a.mp4,b.mp4"]);
  try {
    const result = await diagnose(args, ["a", "b"], (async () => {
      called = true;
      return new Response();
    }) as typeof fetch);
    assert.deepEqual(result.diagnosis, DEFAULT_DIAGNOSIS);
    assert.equal(called, false);
  } finally {
    if (previousToken === undefined) delete process.env.COMPANION_TOKEN;
    else process.env.COMPANION_TOKEN = previousToken;
  }
});

test("studio diagnosis falls back when the bot rejects the request", async () => {
  const previousToken = process.env.COMPANION_TOKEN;
  const previousWarn = console.warn;
  process.env.COMPANION_TOKEN = "test-token";
  console.warn = () => {};
  try {
    const args = parseStudioArgs(["inflict", "user=listener", "videos=a.mp4,b.mp4"]);
    const result = await diagnose(args, ["a", "b"], (async () =>
      new Response(JSON.stringify({ error: "Usage quota reached" }), { status: 429 })
    ) as typeof fetch);
    assert.deepEqual(result.diagnosis, DEFAULT_DIAGNOSIS);
  } finally {
    console.warn = previousWarn;
    if (previousToken === undefined) delete process.env.COMPANION_TOKEN;
    else process.env.COMPANION_TOKEN = previousToken;
  }
});

test("studio diagnosis falls back when the bot is unreachable", async () => {
  const previousToken = process.env.COMPANION_TOKEN;
  const previousWarn = console.warn;
  process.env.COMPANION_TOKEN = "test-token";
  console.warn = () => {};
  try {
    const args = parseStudioArgs(["inflict", "user=listener", "videos=a.mp4,b.mp4"]);
    const result = await diagnose(args, ["a", "b"], (async () => {
      throw new Error("offline");
    }) as typeof fetch);
    assert.deepEqual(result.diagnosis, DEFAULT_DIAGNOSIS);
  } finally {
    console.warn = previousWarn;
    if (previousToken === undefined) delete process.env.COMPANION_TOKEN;
    else process.env.COMPANION_TOKEN = previousToken;
  }
});

test("studio diagnosis sends the username and uses the bot response", async () => {
  const previousToken = process.env.COMPANION_TOKEN;
  const previousLog = console.log;
  process.env.COMPANION_TOKEN = "test-token";
  console.log = () => {};
  let body: Record<string, unknown> | undefined;
  try {
    const args = parseStudioArgs(["inflict", "user=listener", "videos=a.mp4,b.mp4"]);
    const result = await diagnose(args, ["a", "b"], (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ diagnosis: DEFAULT_DIAGNOSIS }), { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(result.diagnosis, DEFAULT_DIAGNOSIS);
    assert.equal(body?.userId, "listener");
  } finally {
    console.log = previousLog;
    if (previousToken === undefined) delete process.env.COMPANION_TOKEN;
    else process.env.COMPANION_TOKEN = previousToken;
  }
});

test("collision windows and original-sound codec", () => {
  assert.deepEqual(collisionWindow("half_bar", 0.5, 2), { period: 1, length: 0.25 });
  assert.deepEqual(collisionWindow("downbeat", 0.5, 2), { period: 2, length: 0.5 });
  assert.deepEqual(collisionWindow("two_bars", 0.5, 2), { period: 8, length: 4 });
  assert.deepEqual(audioCodecArgs("song.MP3"), ["-c:a", "copy"]);
  assert.deepEqual(audioCodecArgs("mix.wav"), ["-c:a", "aac", "-b:a", "320k"]);
});

test("inflict filter chains every video and uses the diagnosis", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inflict-"));
  const diagnosis = structuredClone(DEFAULT_DIAGNOSIS);
  diagnosis.situationship.inflictionChoreography.stutterGlitch = true;
  const filter = inflictFilter({ title: "A - B", bpm: 120, beatsPerBar: 4, diagnosis }, 3, "font.ttf", dir);
  assert.match(filter, /\[1:v\]scale=1280:720/);
  assert.match(filter, /\[3:v\]scale=1280:720/);
  assert.equal(filter.match(/blend=all_mode=difference/g)?.length, 4);
  assert.match(filter, /all_opacity=0\.35/);
  assert.match(filter, /\[4:v\]format=rgba,split=/);
  assert.match(filter, /negate=enable=/);
  assert.match(filter, /enable='lt\(mod\(t\+0\.00000,2\.00000\),0\.50000\)'/);
  assert.equal(fs.readFileSync(path.join(dir, "badge.txt"), "utf8"), "INFLICTION: UNDIAGNOSED");
  assert.throws(() => inflictFilter({ title: "x", bpm: 120, beatsPerBar: 4, diagnosis }, 1, null, dir), /at least two videos/);
});
