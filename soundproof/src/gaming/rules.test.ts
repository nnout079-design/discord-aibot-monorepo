import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGameRules, listRules } from "./rules";
import { GameState } from "./game-state";

function state(overrides: Partial<GameState>): GameState {
  return {
    guildId: "g1",
    channelId: "c1",
    game: "star citizen",
    phase: "match",
    event: "combat detected",
    analysis: "",
    observedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("listRules exposes all active rules", () => {
  const rules = listRules();
  assert.ok(rules.length > 0);
  assert.ok(rules.every((r) => r.id && r.response && Array.isArray(r.games)));
});

test("rule matches exact game and event", () => {
  const reaction = evaluateGameRules(state({ game: "star citizen", event: "quantum travel" }));
  assert.equal(reaction?.ruleId, "star-citizen-status");
});

test("wildcard rule matches any game", () => {
  const reaction = evaluateGameRules(
    state({ game: "some rogue game", event: "vehicle-noise", analysis: "police siren detected" })
  );
  assert.equal(reaction?.ruleId, "vehicle-siren");
});

test("wrong game produces no reaction", () => {
  const reaction = evaluateGameRules(state({ game: "apex legends", event: "respawn beacon scan" }));
  assert.equal(reaction, undefined);
});

test("keyword match triggers without specific event", () => {
  const reaction = evaluateGameRules(
    state({ game: "grand theft auto v", event: "ui text", analysis: "wanted level rising, police chasing" })
  );
  assert.equal(reaction?.ruleId, "gta-wanted-level");
});

test("cooldown suppresses repeated identical triggers", () => {
  const s = state({ game: "rocket league", event: "goal scored" });
  const first = evaluateGameRules(s);
  assert.equal(first?.ruleId, "rocket-league-goal");
  const second = evaluateGameRules({ ...s, updatedAt: new Date().toISOString() });
  assert.equal(second, undefined);
});

test("different guilds do not share cooldowns", () => {
  const a = evaluateGameRules(state({ guildId: "gA", game: "rocket league", event: "goal scored" }));
  const b = evaluateGameRules(state({ guildId: "gB", game: "rocket league", event: "goal scored" }));
  assert.equal(a?.ruleId, "rocket-league-goal");
  assert.equal(b?.ruleId, "rocket-league-goal");
});
