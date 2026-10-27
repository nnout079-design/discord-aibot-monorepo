import test from "node:test";
import assert from "node:assert/strict";
import { MentalHealthClient } from "./mental-health-client";

function mockFetch(responses: { url: RegExp; json: unknown; status?: number }[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const match = responses.find((r) => r.url.test(url));
    return new Response(JSON.stringify(match?.json ?? {}), { status: match?.status ?? 200 });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("health fetches /health", async () => {
  const { calls, restore } = mockFetch([{ url: /\/health$/, json: { status: "ok", loaded_models: ["crisis"] } }]);
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000" });
  const result = await client.health();
  assert.equal(result.status, "ok");
  assert.ok(calls[0].endsWith("/health"));
  restore();
});

test("fillMask posts to /bertcase/fillmask", async () => {
  const { calls, restore } = mockFetch([
    {
      url: /\/bertcase\/fillmask$/,
      json: { model: "modernbert", predictions: [{ token: "world", word: "world", score: 0.9 }] },
    },
  ]);
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000" });
  const result = await client.fillMask("hello [MASK]");
  assert.equal(result.predictions[0].word, "world");
  assert.ok(calls[0].endsWith("/bertcase/fillmask"));
  restore();
});

test("analyze throws on non-ok response", async () => {
  const { restore } = mockFetch([{ url: /.*/, json: { error: "bad" }, status: 500 }]);
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000", timeoutMs: 1000 });
  await assert.rejects(() => client.analyze("hi"), /500/);
  restore();
});
