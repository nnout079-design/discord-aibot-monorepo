import test from "node:test";
import assert from "node:assert/strict";
import { companionHub } from "./companion-hub";
import { companionControl, getSession, COMPANION_SESSION, parseStartRequest } from "./session";

test("parseStartRequest validates pattern and ranges", () => {
  assert.deepEqual(parseStartRequest({}), { pattern: undefined, bpm: undefined, lead: undefined, beats: undefined, username: undefined });
  assert.deepEqual(parseStartRequest({ pattern: "afrobeat", bpm: 120, lead: 4, beats: 3 }), { pattern: "afrobeat", bpm: 120, lead: 4, beats: 3, username: undefined });
  assert.throws(() => parseStartRequest({ pattern: "polka" }), /pattern must be one of: afrobeat/);
  assert.throws(() => parseStartRequest({ bpm: 500 }), /bpm must be a number from 40 to 240/);
  assert.throws(() => parseStartRequest({ lead: "soon" }), /lead/);
  assert.throws(() => parseStartRequest([]), /JSON object/);
});

test("companionControl arms a bar-aligned entry and stops it", async () => {
  const log = console.log;
  console.log = () => {};
  try {
    const before = Date.now();
    const started = await companionControl("start", { pattern: "taiko", bpm: 120, lead: 2 });
    assert.equal(started.status, 200);
    const body = started.body as { startAt: number; countInAt: number; bpm: number; pattern: string };
    assert.equal(body.bpm, 120);
    assert.equal(body.pattern, "taiko");
    assert.equal(body.startAt % 2000, 0);
    assert.equal(body.startAt - body.countInAt, 2000);
    assert.ok(body.startAt >= before + 2000);
    assert.ok(getSession(COMPANION_SESSION));

    assert.deepEqual((await companionControl("stop", {})).body, { stopped: true });
    assert.equal(getSession(COMPANION_SESSION), undefined);
    const events: string[] = [];
    const publish = companionHub.publish.bind(companionHub);
    companionHub.publish = event => { events.push(event.type); publish(event); };
    try {
      assert.deepEqual((await companionControl("stop", {})).body, { stopped: false });
    } finally {
      companionHub.publish = publish;
    }
    assert.deepEqual(events, ["song-stop"]);

    assert.equal((await companionControl("start", { pattern: "polka" })).status, 400);
  } finally {
    console.log = log;
  }
});
