import test from "node:test";
import assert from "node:assert/strict";
import { assessSnipeRisk, adviseTiebreak, COUNTERMEASURES } from "./streamsnipe";
import { recordDiagnostic } from "./diagnostics";

function evidence(guildId: string, event: string, detail = ""): void {
  recordDiagnostic({
    guildId,
    channelId: "c1",
    game: "fortnite",
    source: "frame",
    stage: "rules",
    outcome: "ok",
    event,
    detail,
  });
}

test("clean evidence reports low risk", () => {
  const report = assessSnipeRisk("snipe-clean");
  assert.equal(report.level, "low");
  assert.equal(report.score, 0);
  assert.ok(report.countermeasures.length > 0);
});

test("explicit stream-snipe cues raise risk", () => {
  evidence("snipe-g1", "combat", "enemy was pre-aiming the corner, knew your position");
  evidence("snipe-g1", "death", "same player got you again — on your stream?");
  evidence("snipe-g1", "death", "died to stream sniper kill cam");
  const report = assessSnipeRisk("snipe-g1");
  assert.notEqual(report.level, "low");
  assert.ok(report.indicators.length >= 2);
  assert.ok(report.countermeasures.some((c) => /latency/i.test(c)));
});

test("death clusters alone contribute to risk score", () => {
  for (let i = 0; i < 4; i++) evidence("snipe-g2", "death", `eliminated attempt ${i}`);
  const report = assessSnipeRisk("snipe-g2");
  assert.ok(report.score >= 3);
  assert.ok(report.indicators.some((i) => i.includes("deaths")));
});

test("countermeasure playbook covers platform, discipline, and tactics", () => {
  assert.ok(COUNTERMEASURES.platform.some((c) => /YouTube/i.test(c)));
  assert.ok(COUNTERMEASURES.discipline.length >= 3);
  assert.ok(COUNTERMEASURES.tactical.length >= 2);
});

test("tiebreak falls back to heuristic plays without OpenAI key", async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const advice = await adviseTiebreak("snipe-g3");
    assert.equal(advice.source, "heuristic");
    assert.ok(advice.plays.length >= 2);
  } finally {
    if (saved) process.env.OPENAI_API_KEY = saved;
  }
});
