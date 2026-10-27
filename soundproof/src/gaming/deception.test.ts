import test from "node:test";
import assert from "node:assert/strict";
import {
  listDeceptionTactics,
  getDeceptionTactic,
  deployDeception,
  suggestDeception,
  DECEPTION_TACTICS,
} from "./deception";

const guild = () => `g-${Math.random().toString(36).slice(2)}`;

test("catalog exposes every tactic with required fields", () => {
  const tactics = listDeceptionTactics();
  assert.ok(tactics.length >= 16);
  for (const t of tactics) {
    assert.ok(t.id);
    assert.ok(t.name);
    assert.ok(t.category);
    assert.ok(t.execution);
    assert.ok(t.risk);
  }
});

test("getDeceptionTactic returns known and unknown ids", () => {
  assert.equal(getDeceptionTactic("wounded-prey")?.name, "Wounded prey");
  assert.equal(getDeceptionTactic("not-real"), undefined);
});

test("deployDeception returns execution steps", () => {
  const gid = guild();
  const result = deployDeception({ guildId: gid, channelId: "c", tacticId: "peek-and-hide", requestedBy: "Test" });
  assert.equal(result.executed, true);
  assert.equal(result.tactic.id, "peek-and-hide");
  assert.ok(result.message.includes("Execute:"));
});

test("same tactic has a reuse cooldown", () => {
  const gid = guild();
  deployDeception({ guildId: gid, channelId: "c", tacticId: "noise-throw", requestedBy: "Test" });
  const second = deployDeception({ guildId: gid, channelId: "c", tacticId: "noise-throw", requestedBy: "Test" });
  assert.equal(second.executed, false);
  assert.ok(second.message.includes("just saw it"));
});

test("unknown tactic returns catalog hint", () => {
  const result = deployDeception({ guildId: guild(), channelId: "c", tacticId: "fake-tactic", requestedBy: "Test" });
  assert.equal(result.executed, false);
  assert.ok(result.message.includes(DECEPTION_TACTICS[0].id));
});

test("suggestDeception returns tactics and a basis string", () => {
  const { tactics, basis } = suggestDeception(guild());
  assert.ok(Array.isArray(tactics));
  assert.ok(tactics.length > 0);
  assert.ok(basis.length > 0);
});
