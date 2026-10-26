import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Pool } from "pg";
import { TrackAttributes } from "../../sync/entry";
import { createQuotaStore, DIAGNOSIS_SCHEMA, formatQuota, GeminiStudioAgent, MemoryQuotaStore, normalizeDiagnosis, PgQuotaStore, QuotaExceededError, QuotaStore, RedisQuotaStore, UserQuotaManager } from "./gemini-adapter";

const track: TrackAttributes = { name: "Song", artist: "Band", tags: ["hyperpop", "glitch"], bpm: 160, danceability: 0.8 };

test("quota is a rolling window per user", async () => {
  let now = 1_000_000;
  const quota = new UserQuotaManager(2, 60_000, () => now);
  assert.equal((await quota.reserve("a")).allowed, true);
  now += 10_000;
  assert.equal((await quota.reserve("a")).allowed, true);
  assert.equal((await quota.reserve("a")).allowed, false);
  assert.equal((await quota.reserve("b")).allowed, true);
  const status = await quota.checkQuota("a");
  assert.deepEqual([status.used, status.remaining, status.resetInMs], [2, 0, 50_000]);
  assert.equal(formatQuota(status), "0/2 remaining (resets in 1m)");
  now += 50_001;
  assert.equal((await quota.checkQuota("a")).remaining, 1);
  assert.equal((await quota.reserve("a", true)).allowed, true);
  assert.equal((await quota.checkQuota("a")).used, 1);
});

test("bad quota env values fall back to the defaults", () => {
  process.env.STUDIO_USER_QUOTA_LIMIT = "lots";
  try {
    assert.equal(new UserQuotaManager(5).limit, 5);
  } finally {
    delete process.env.STUDIO_USER_QUOTA_LIMIT;
  }
});

test("without an API key heuristic diagnoses are free", async () => {
  const agent = new GeminiStudioAgent("", new UserQuotaManager(1));
  for (let i = 0; i < 3; i++) {
    const { diagnosis, quota } = await agent.diagnose(track, ["a", "b"], "u1", { originalSound: true, videoOnly: true });
    assert.equal(diagnosis.source, "heuristic");
    assert.equal(diagnosis.genre.primaryGenre, "Hyperpop / Glitch-Core");
    assert.equal(quota.used, 0);
  }
  assert.equal((await agent.diagnose(track, [], "u1", { bypassQuota: true })).quota.unlimited, true);
});

test("successful Gemini diagnoses reserve quota atomically", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({}) }] } }]
  }), { status: 200 })) as unknown as typeof fetch;
  const agent = new GeminiStudioAgent("key", new UserQuotaManager(2), { fetchImpl });
  assert.equal((await agent.diagnose(track, [], "gemini-user")).diagnosis.source, "gemini");
  assert.equal((await agent.diagnose(track, [], "gemini-user")).diagnosis.source, "gemini");
  await assert.rejects(agent.diagnose(track, [], "gemini-user"), QuotaExceededError);
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
  const fetchImpl = (async () => new Response("unavailable", { status: 500 })) as unknown as typeof fetch;
  const agent = new GeminiStudioAgent("key", new UserQuotaManager(1), { fetchImpl });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await agent.diagnose(track, [], "u3")).diagnosis.source, "heuristic");
    const second = await agent.diagnose(track, [], "u3");
    assert.equal(second.diagnosis.source, "heuristic");
    assert.equal(second.quota.used, 0);
  } finally {
    console.warn = warn;
  }
});

test("quota manager falls back to its memory store when the configured store fails", async () => {
  const failure = async (): Promise<never> => { throw new Error("store offline"); };
  const store: QuotaStore = {
    history: failure,
    reserve: failure,
    release: failure
  };
  const quota = new UserQuotaManager(1, undefined, undefined, store);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await quota.reserve("fallback-user")).allowed, true);
    assert.equal((await quota.reserve("fallback-user")).allowed, false);
    assert.equal((await quota.checkQuota("fallback-user")).used, 1);
  } finally {
    console.warn = warn;
  }
});

test("Postgres quota store retries schema setup after a failure", async () => {
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      if (calls === 1) throw new Error("database starting");
      return { rows: [] };
    }
  } as unknown as Pool;
  const store = new PgQuotaStore(pool);
  await assert.rejects(store.history("retry-user", 0), /database starting/);
  assert.deepEqual(await store.history("retry-user", 0), []);
  assert.equal(calls, 4);
});

test("createQuotaStore prefers Redis, then Postgres, then memory", async () => {
  const redisStore = createQuotaStore({
    REDIS_URL: "redis://127.0.0.1:56379",
    DATABASE_URL: "postgres://postgres:pw@127.0.0.1:55432/postgres"
  });
  assert.ok(redisStore instanceof RedisQuotaStore);
  redisStore.disconnect();

  const pgStore = createQuotaStore({ DATABASE_URL: "postgres://postgres:pw@127.0.0.1:55432/postgres" });
  assert.ok(pgStore instanceof PgQuotaStore);
  await (pgStore as unknown as { pool: Pool }).pool.end();

  assert.ok(createQuotaStore({}) instanceof MemoryQuotaStore);
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
test("Postgres quota store reserves atomically, releases usage, and returns ordered history", { skip: !testDatabaseUrl }, async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query("DROP TABLE IF EXISTS studio_quota_usage");
    const store = new PgQuotaStore(pool);
    let now = 1_700_000_000_000;
    const quota = new UserQuotaManager(2, 60_000, () => now, store);
    const first = await quota.reserve("pg-user");
    now += 1_000;
    const second = await quota.reserve("pg-user");
    now += 1_000;
    const third = await quota.reserve("pg-user");
    assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
    await first.release();
    now += 1_000;
    assert.equal((await quota.reserve("pg-user")).allowed, true);
    const history = await store.history("pg-user", 1_699_999_900_000);
    assert.deepEqual(history, [1_700_000_001_000, 1_700_000_003_000]);

    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      store.reserve("pg-concurrent", 1_700_000_100_000 + index, 1_700_000_000_000, 3)
    ));
    assert.equal(concurrent.filter(Boolean).length, 3);
  } finally {
    await pool.end();
  }
});

const testRedisUrl = process.env.TEST_REDIS_URL;
test("Redis quota store reserves atomically, releases usage, and returns ordered history", { skip: !testRedisUrl }, async () => {
  if (!testRedisUrl) return;
  const prefix = `studio:quota:test:${randomUUID()}:`;
  const keys = [`${prefix}redis-user`, `${prefix}redis-concurrent`];
  const client = new Redis(testRedisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const store = new RedisQuotaStore(client, prefix);
  try {
    await client.connect();
    await client.del(...keys);
    let now = 1_700_000_000_000;
    const quota = new UserQuotaManager(2, 60_000, () => now, store);
    const first = await quota.reserve("redis-user");
    now += 1_000;
    const second = await quota.reserve("redis-user");
    now += 1_000;
    const third = await quota.reserve("redis-user");
    assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
    await first.release();
    now += 1_000;
    assert.equal((await quota.reserve("redis-user")).allowed, true);
    const history = await store.history("redis-user", 1_699_999_900_000);
    assert.deepEqual(history, [1_700_000_001_000, 1_700_000_003_000]);

    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      store.reserve("redis-concurrent", 1_700_000_100_000 + index, 1_700_000_000_000, 3)
    ));
    assert.equal(concurrent.filter(Boolean).length, 3);
  } finally {
    await client.del(...keys).catch(() => {});
    await client.quit().catch(() => client.disconnect());
  }
});

test("normalizeDiagnosis fills everything from the fallback for junk", () => {
  const fallback = new GeminiStudioAgent("").heuristicDiagnosis(track);
  const out = normalizeDiagnosis("junk", fallback);
  assert.deepEqual(out.genre, fallback.genre);
  assert.deepEqual(out.situationship, fallback.situationship);
});
