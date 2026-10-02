import test from "node:test";
import assert from "node:assert/strict";
import { CompanionHub } from "./companion-hub";
import { planEntry, songEntryEvent } from "./entry";

async function readUntil(res: Response, needle: string): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

test("time endpoint is public, events need the token", async () => {
  const hub = new CompanionHub("secret");
  const port = await hub.listen(0);
  try {
    const time = await (await fetch(`http://127.0.0.1:${port}/sync/time`)).json() as { now: number };
    assert.ok(Math.abs(time.now - Date.now()) < 1000);
    assert.equal((await fetch(`http://127.0.0.1:${port}/sync/events`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/sync/events`, { headers: { authorization: "Bearer nope" } })).status, 401);
  } finally {
    await hub.close();
  }
});

test("events are refused when no token is configured", async () => {
  const hub = new CompanionHub("");
  const port = await hub.listen(0);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/sync/events`, { headers: { authorization: "Bearer " } })).status, 503);
  } finally {
    await hub.close();
  }
});

test("connected companions receive published events and late joiners get the armed entry", async () => {
  const hub = new CompanionHub("secret");
  const port = await hub.listen(0);
  const headers = { authorization: "Bearer secret" };
  try {
    const first = await fetch(`http://127.0.0.1:${port}/sync/events`, { headers });
    assert.equal(first.status, 200);
    while (hub.connected === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const event = songEntryEvent(planEntry(Date.now(), 8000, 120), null, null);
    hub.publish(event);
    const text = await readUntil(first, "\n\n" + "event:");
    assert.match(text, /event: song-entry\ndata: \{.*"startAt":/);

    const late = await fetch(`http://127.0.0.1:${port}/sync/events`, { headers });
    assert.match(await readUntil(late, "song-entry"), new RegExp(`"startAt":${event.startAt}`));
  } finally {
    await hub.close();
  }
});

test("control endpoints need the token and pass the JSON body to the handler", async () => {
  const hub = new CompanionHub("secret");
  const calls: Array<{ action: string; body: unknown }> = [];
  hub.setControl(async (action, body) => {
    calls.push({ action, body });
    return { status: 200, body: { ok: true } };
  });
  const port = await hub.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const auth = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${url}/sync/start`, { method: "POST", body: "{}" })).status, 401);
    assert.equal(calls.length, 0);

    const start = await fetch(`${url}/sync/start`, { method: "POST", headers: auth, body: JSON.stringify({ pattern: "taiko", bpm: 120 }) });
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { ok: true });
    assert.equal((await fetch(`${url}/sync/stop`, { method: "POST", headers: auth })).status, 200);
    assert.deepEqual(calls, [{ action: "start", body: { pattern: "taiko", bpm: 120 } }, { action: "stop", body: {} }]);

    assert.equal((await fetch(`${url}/sync/start`, { method: "POST", headers: auth, body: "{nope" })).status, 400);
    assert.equal((await fetch(`${url}/sync/time`, { method: "POST", headers: auth })).status, 405);
  } finally {
    await hub.close();
  }
});

test("control endpoints are unavailable without a handler", async () => {
  const hub = new CompanionHub("secret");
  const port = await hub.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sync/start`, { method: "POST", headers: { authorization: "Bearer secret" } });
    assert.equal(res.status, 503);
  } finally {
    await hub.close();
  }
});
