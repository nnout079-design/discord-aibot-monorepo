import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTelemetry, updateGameState, getGameState } from "./game-state";

test("normalizeTelemetry requires core fields", () => {
  assert.equal(normalizeTelemetry({ guildId: "", channelId: "c", game: "g", event: "e" }), undefined);
  assert.equal(normalizeTelemetry({ guildId: "g", channelId: "c", game: "", event: "e" }), undefined);
  assert.equal(normalizeTelemetry({ guildId: "g", channelId: "c", game: "g", event: "" }), undefined);
});

test("normalizeTelemetry trims and lowercases game/event", () => {
  const t = normalizeTelemetry({ guildId: "g", channelId: "c", game: "  Star Citizen  ", event: "COMBAT" });
  assert.equal(t?.game, "star citizen");
  assert.equal(t?.event, "combat");
});

test("normalizeTelemetry defaults unknown phase", () => {
  const t = normalizeTelemetry({ guildId: "g", channelId: "c", game: "g", event: "e", phase: "invalid" as any });
  assert.equal(t?.phase, "unknown");
});

test("updateGameState stores and enriches state", () => {
  const s = updateGameState({
    guildId: "g",
    channelId: "c",
    game: "g",
    phase: "match",
    event: "e",
    observedAt: new Date().toISOString(),
  });
  assert.equal(s.guildId, "g");
  assert.equal(s.game, "g");
  assert.ok(s.updatedAt);
  assert.deepEqual(getGameState("g"), s);
});
