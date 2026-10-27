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
  assert.equal(result.model, "modernbert");
  assert.equal(result.predictions[0].word, "world");
  assert.ok(calls[0].endsWith("/bertcase/fillmask"));
  restore();
});

test("caseStyle posts to /bertcase/style", async () => {
  const { restore } = mockFetch([
    {
      url: /\/bertcase\/style$/,
      json: { style: "lower", letters: 4, uppercase: 0, lowercase: 4, confidence: 1 },
    },
  ]);
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000" });
  const result = await client.caseStyle("test");
  assert.equal(result.style, "lower");
  assert.equal(result.letters, 4);
  restore();
});

test("analyze throws on non-ok response", async () => {
  const { restore } = mockFetch([{ url: /.*/, json: { error: "bad" }, status: 500 }]);
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000", timeoutMs: 1000 });
  await assert.rejects(() => client.analyze("hi"), /500/);
  restore();
});

test("formatSummary includes crisis, emotion, triage", () => {
  const client = new MentalHealthClient({ baseUrl: "http://localhost:8000" });
  const summary = client.formatSummary({
    text_excerpt: "hi",
    disclaimer: "not a doctor",
    crisis: { label: "safe", confidence: 0.9, severity: "low", is_crisis: false },
    emotion: { top_emotions: [{ label: "joy", score: 0.8 }] },
    triage: { level: "low", urgency: "none", suggested_resources: [], reasoning: "" },
  });
  assert.ok(summary.includes("Crisis risk"));
  assert.ok(summary.includes("joy"));
  assert.ok(summary.includes("Triage level"));
});
