import test from "node:test";
import assert from "node:assert/strict";
import { TrackAttributes } from "../../sync/entry";
import { DIAGNOSIS_SCHEMA, formatQuota, GeminiStudioAgent, normalizeDiagnosis, QuotaExceededError, UserQuotaManager } from "./gemini-adapter";

const track: TrackAttributes = { name: "Song", artist: "Band", tags: ["hyperpop", "glitch"], bpm: 160, danceability: 0.8 };

test("quota is a rolling window per user", () => {
  let now = 1_000_000;
  const quota = new UserQuotaManager(2, 60_000, () => now);
  assert.equal(quota.consumeQuota("a"), true);
  now += 10_000;
  assert.equal(quota.consumeQuota("a"), true);
  assert.equal(quota.consumeQuota("a"), false);
  assert.equal(quota.consumeQuota("b"), true);
  const status = quota.checkQuota("a");
  assert.deepEqual([status.used, status.remaining, status.resetInMs], [2, 0, 50_000]);
  assert.equal(formatQuota(status), "0/2 remaining (resets in 1m)");
  now += 50_001;
  assert.equal(quota.checkQuota("a").remaining, 1);
  assert.equal(quota.consumeQuota("a", true), true);
  assert.equal(quota.checkQuota("a").used, 1);
});

test("bad quota env values fall back to the defaults", () => {
  process.env.STUDIO_USER_QUOTA_LIMIT = "lots";
  try {
    assert.equal(new UserQuotaManager(5).limit, 5);
  } finally {
    delete process.env.STUDIO_USER_QUOTA_LIMIT;
  }
});

test("without an API key the heuristic diagnoses and the quota still counts", async () => {
  const agent = new GeminiStudioAgent("", new UserQuotaManager(1));
  const { diagnosis, quota } = await agent.diagnose(track, ["a", "b"], "u1", { originalSound: true, videoOnly: true });
  assert.equal(diagnosis.source, "heuristic");
  assert.equal(diagnosis.genre.primaryGenre, "Hyperpop / Glitch-Core");
  assert.equal(quota.remaining, 0);
  await assert.rejects(agent.diagnose(track, [], "u1"), QuotaExceededError);
  assert.equal((await agent.diagnose(track, [], "u1", { bypassQuota: true })).quota.unlimited, true);
});

test("Gemini output is requested with a schema and normalized", async () => {
  let request: { url: string; init: RequestInit } | null = null;
  const reply = {
    genre: { primaryGenre: "Breakcore", subgenres: ["Jungle"], energy: 7, aestheticPalette: ["#ff0000", "nope", "#00ff00"], visualTempoFactor: 1.4, tags: ["fast"] },
    situationship: { type: "ghosting", headline: "Left on read", dissonanceScore: 140, narrativeDiagnosis: "Gone.", inflictionChoreography: { blendMode: "multiply", collisionRate: "bar", stutterGlitch: false, hudBadge: "GHOSTED", opacityRange: [0.9, 0.2] } }
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    request = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const agent = new GeminiStudioAgent("key", new UserQuotaManager(5), { model: "gemini-test", fetchImpl });
  const { diagnosis } = await agent.diagnose(track, ["a", "b"], "u2");
  assert.ok(request);
  const sent = request as { url: string; init: RequestInit };
  assert.match(sent.url, /models\/gemini-test:generateContent$/);
  assert.equal((sent.init.headers as Record<string, string>)["x-goog-api-key"], "key");
  const body = JSON.parse(String(sent.init.body));
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, DIAGNOSIS_SCHEMA);
  assert.equal(diagnosis.source, "gemini");
  assert.equal(diagnosis.model, "gemini-test");
  assert.equal(diagnosis.genre.energy, 1);
  assert.deepEqual(diagnosis.genre.aestheticPalette, ["#ff0000", "#00ff00"]);
  assert.equal(diagnosis.situationship.type, "ghosting");
  assert.equal(diagnosis.situationship.dissonanceScore, 100);
  assert.equal(diagnosis.situationship.inflictionChoreography.blendMode, "difference");
  assert.deepEqual(diagnosis.situationship.inflictionChoreography.opacityRange, [0.2, 0.9]);
});

test("a failing Gemini call falls back to the heuristic", async () => {
  const fetchImpl = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
  const agent = new GeminiStudioAgent("key", new UserQuotaManager(5), { fetchImpl });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await agent.diagnose(track, [], "u3")).diagnosis.source, "heuristic");
  } finally {
    console.warn = warn;
  }
});

test("normalizeDiagnosis fills everything from the fallback for junk", () => {
  const fallback = new GeminiStudioAgent("").heuristicDiagnosis(track);
  const out = normalizeDiagnosis("junk", fallback);
  assert.deepEqual(out.genre, fallback.genre);
  assert.deepEqual(out.situationship, fallback.situationship);
});
