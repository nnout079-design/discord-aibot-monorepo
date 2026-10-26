import assert from "node:assert/strict";
import test from "node:test";
import {
  camoEffectiveness,
  DEMO_SCENE,
  exposureAt,
  formatStealthPlan,
  illuminationAt,
  parseStealthScene,
  runStealthCircuit,
  StealthScene
} from "../src/gaming/stealth-circuit";

const baseScene = (overrides: Partial<StealthScene> = {}): StealthScene => ({
  agent: { x: 0, y: 0, terrain: "urban" },
  lights: [],
  spots: [],
  threats: [],
  camo: { pattern: "urban digital", coverage: 0.8, terrains: ["urban"] },
  ...overrides
});

test("illumination peaks at a light's center and falls to ambient outside its radius", () => {
  const lights = [{ x: 0, y: 0, intensity: 2, radius: 5 }];

  assert.equal(illuminationAt({ x: 0, y: 0 }, lights), 1);
  assert.equal(illuminationAt({ x: 6, y: 0 }, lights, 0.2), 0.2);
});

test("matching terrain camouflage lowers exposure compared with a mismatch", () => {
  const scene = baseScene();

  assert.ok(exposureAt({ x: 0, y: 0 }, 0, "urban", scene) < exposureAt({ x: 0, y: 0 }, 0, "forest", scene));
  assert.ok(camoEffectiveness(scene.camo, "URBAN", 0.2) > camoEffectiveness(scene.camo, "forest", 0.2));
});

test("moving reduces camouflage effectiveness to sixty percent", () => {
  const camo = { pattern: "urban digital", coverage: 0.8, terrains: ["urban"] };

  assert.equal(camoEffectiveness(camo, "urban", 0.25, true), camoEffectiveness(camo, "urban", 0.25) * 0.6);
});

test("a lit spot is skipped when a dark spot is available, regardless of cover", () => {
  const scene = baseScene({
    lights: [{ x: 0, y: 0, intensity: 1, radius: 10 }],
    spots: [
      { id: "lit", x: 1, y: 0, cover: 1, terrain: "urban" },
      { id: "dark", x: 20, y: 0, cover: 0.5, terrain: "urban" }
    ]
  });

  assert.equal(runStealthCircuit(scene).target?.spotId, "dark");
});

test("all-lit scenes fall back to the least-lit spot and report the lack of dark cover", () => {
  const scene = baseScene({
    lights: [{ x: 0, y: 0, intensity: 1, radius: 40 }],
    spots: [
      { id: "bright", x: 1, y: 0, cover: 0, terrain: "urban" },
      { id: "less-bright", x: 10, y: 0, cover: 0, terrain: "urban" }
    ]
  });
  const plan = runStealthCircuit(scene);

  assert.equal(plan.target?.spotId, "less-bright");
  assert.ok(plan.actions.includes("No dark cover available — pick the least-lit spot and minimise movement"));
});

test("holds position when moving to the available spot cannot improve the current score", () => {
  const plan = runStealthCircuit(baseScene({
    spots: [{ id: "same-light", x: 10, y: 0, cover: 0, terrain: "urban" }]
  }));

  assert.equal(plan.target, null);
  assert.ok(plan.actions.includes("Hold position in shadow"));
});

test("threat penalties steer the target away from a nearby threat", () => {
  const scene = baseScene({
    lights: [{ x: 0, y: 0, intensity: 1, radius: 2 }],
    spots: [
      { id: "threatened", x: 10, y: 0, cover: 0.5, terrain: "urban" },
      { id: "safe", x: 0, y: 10, cover: 0.5, terrain: "urban" }
    ],
    threats: [{ x: 10, y: 0 }]
  });

  assert.equal(runStealthCircuit(scene).target?.spotId, "safe");
});

test("risk uses the final exposure thresholds", () => {
  const riskFor = (ambientLight: number) => runStealthCircuit(baseScene({
    ambientLight,
    camo: { pattern: "none", coverage: 0, terrains: [] }
  })).risk;

  assert.equal(riskFor(0.149), "low");
  assert.equal(riskFor(0.15), "medium");
  assert.equal(riskFor(0.4), "high");
});

test("demo plan chooses the dark alley and uses full camouflage", () => {
  const plan = runStealthCircuit(DEMO_SCENE);

  assert.equal(plan.target?.spotId, "dark alley");
  assert.equal(plan.camo.mode, "full");
  assert.ok(plan.actions.some(action => action.includes("Leave the light of streetlamp")));
});

test("stealth plan output is Discord-friendly and bounded", () => {
  const plan = runStealthCircuit(DEMO_SCENE);
  const formatted = formatStealthPlan(plan);

  assert.ok(formatted.length <= 1800);
  assert.match(formatted, /Stealth circuit — LOW risk/);
  assert.match(formatted, /Target: dark alley/);
  assert.match(formatted, /1\. Leave the light of streetlamp/);
});

test("scene parser requires arrays and rejects invalid numeric geometry", () => {
  const base = {
    agent: { x: 0, y: 0 },
    lights: [],
    spots: [],
    threats: [],
    camo: { pattern: "digital", coverage: 0.5, terrains: [] }
  };

  assert.equal(parseStealthScene({ ...base, lights: undefined }), undefined);
  assert.equal(parseStealthScene({ ...base, agent: { x: Number.NaN, y: 0 } }), undefined);
  assert.equal(parseStealthScene({ ...base, lights: [{ x: 0, y: 0, intensity: 0.5, radius: 0 }] }), undefined);
});

test("scene parser enforces collection, identifier, and camouflage limits", () => {
  const base = {
    agent: { x: 0, y: 0 },
    lights: [],
    spots: [],
    threats: [],
    camo: { pattern: "digital", coverage: 0.5, terrains: [] }
  };

  assert.equal(parseStealthScene({ ...base, lights: Array(65).fill({ x: 0, y: 0, intensity: 0.5, radius: 1 }) }), undefined);
  assert.equal(parseStealthScene({ ...base, spots: Array(257).fill({ id: "spot", x: 0, y: 0, cover: 0.5 }) }), undefined);
  assert.equal(parseStealthScene({ ...base, threats: Array(65).fill({ x: 0, y: 0 }) }), undefined);
  assert.equal(parseStealthScene({ ...base, spots: [{ id: " ", x: 0, y: 0, cover: 0.5 }] }), undefined);
  assert.equal(parseStealthScene({ ...base, camo: { pattern: "x".repeat(65), coverage: 0.5, terrains: [] } }), undefined);
  assert.equal(parseStealthScene({ ...base, camo: { pattern: "digital", coverage: 0.5, terrains: Array(17).fill("urban") } }), undefined);
});

test("scene parser clamps intensity, coverage, and cover", () => {
  const parsed = parseStealthScene({
    agent: { x: 0, y: 0 },
    lights: [{ x: 0, y: 0, intensity: 2, radius: 1 }],
    spots: [{ id: "spot", x: 1, y: 0, cover: -1 }],
    threats: [],
    camo: { pattern: "digital", coverage: 2, terrains: [] }
  });

  assert.equal(parsed?.lights[0].intensity, 1);
  assert.equal(parsed?.spots[0].cover, 0);
  assert.equal(parsed?.camo.coverage, 1);
});
