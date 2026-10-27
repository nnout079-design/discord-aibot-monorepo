import test from "node:test";
import assert from "node:assert/strict";
import { adjudicate, createMemoryKv, getServiceRecord, JusticePolicy } from "./justice";

const policy: Partial<JusticePolicy> = {
  actionCooldownMs: 1_000,
  velocityMax: 3,
  velocityWindowMs: 60_000,
  dailyCap: 25,
  article15Strikes: 2,
  confinementStrikes: 3,
  confinementMs: 60_000,
  offenseWindowMs: 60_000,
};

const ctx = (overrides = {}) => ({ guildId: "g1", userId: "u1", action: "ask", xp: 10, ...overrides });

test("first action awards full XP", async () => {
  const kv = createMemoryKv();
  const verdict = await adjudicate(kv, ctx(), policy);
  assert.equal(verdict.awarded, true);
  assert.equal(verdict.xp, 10);
  assert.equal(verdict.penalty, "none");
});

test("repeating the same action inside its cooldown is denied and counted", async () => {
  const kv = createMemoryKv();
  await adjudicate(kv, ctx(), policy);
  const verdict = await adjudicate(kv, ctx(), policy);
  assert.equal(verdict.awarded, false);
  assert.equal(verdict.penalty, "warning");
});

test("velocity limit denies spam across different actions", async () => {
  const kv = createMemoryKv();
  for (const action of ["ask", "game", "wellness"]) {
    const v = await adjudicate(kv, ctx({ action, xp: 5 }), policy);
    assert.equal(v.awarded, true, `/${action} should award`);
  }
  const verdict = await adjudicate(kv, ctx({ action: "listen", xp: 5 }), policy);
  assert.equal(verdict.awarded, false);
  assert.match(verdict.reason ?? "", /velocity/i);
});

test("daily cap clamps the award instead of overshooting", async () => {
  const kv = createMemoryKv();
  const first = await adjudicate(kv, ctx({ xp: 20 }), { ...policy, velocityMax: 99 });
  assert.equal(first.xp, 20);
  const second = await adjudicate(kv, ctx({ action: "game", xp: 10 }), { ...policy, velocityMax: 99 });
  assert.equal(second.awarded, true);
  assert.equal(second.xp, 5);
  const third = await adjudicate(kv, ctx({ action: "listen", xp: 10 }), { ...policy, velocityMax: 99 });
  assert.equal(third.awarded, false);
  assert.match(third.reason ?? "", /cap/i);
});

test("offenses escalate warning -> article15 -> confinement", async () => {
  const kv = createMemoryKv();
  await adjudicate(kv, ctx(), policy);
  const first = await adjudicate(kv, ctx(), policy);
  const second = await adjudicate(kv, ctx(), policy);
  const third = await adjudicate(kv, ctx(), policy);
  assert.equal(first.penalty, "warning");
  assert.equal(second.escalatedTo, "article15");
  assert.equal(third.escalatedTo, "confinement");

  const record = await getServiceRecord(kv, "g1", "u1", policy);
  assert.equal(record.penalty, "confinement");
  assert.equal(record.offenses, 3);
  assert.ok(record.confinedUntil && record.confinedUntil > Date.now());

  const duringConfinement = await adjudicate(kv, ctx({ action: "stream" }), policy);
  assert.equal(duringConfinement.awarded, false);
  assert.equal(duringConfinement.penalty, "confinement");
});

test("article15 halves subsequent awards", async () => {
  const kv = createMemoryKv();
  await kv.incr("progress:ucgj:off:g1:u1", 2, 60_000);
  const verdict = await adjudicate(kv, ctx(), policy);
  assert.equal(verdict.awarded, true);
  assert.equal(verdict.xp, 5);
  assert.equal(verdict.penalty, "article15");
});
