import assert from "node:assert/strict";
import test from "node:test";
import {
  camoEffectiveness,
  DEFAULT_TUNING,
  DEMO_SCENE,
  exposureAt,
  formatStealthPlan,
  illuminationAt,
  parseStealthScene,
  runStealthCircuit,
  StealthScene,
  updateLitTimer
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
  assert.ok(plan.shootOut);
  assert.ok(plan.actions.some(action => action.includes("Shoot out streetlamp #0")));
});

test("shoots out a nearby shootable light after the timer when threats are clear", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "streetlamp", x: 0, y: 0, intensity: 1, radius: 8, shootable: true }],
    spots: [{ id: "alley", x: 20, y: 0, cover: 1, terrain: "urban" }],
    secondsLit: 6
  }));

  assert.equal(plan.shootOut?.index, 0);
  assert.equal(plan.shootOut?.exposureAfter, 0);
  assert.ok(plan.actions.some(action => action.includes("Shoot out streetlamp #0")));
});

test("holds fire until the timer when dark cover exists", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "lamp", x: 0, y: 0, intensity: 1, radius: 8, shootable: true }],
    spots: [{ id: "dark", x: 20, y: 0, cover: 1, terrain: "urban" }],
    secondsLit: 2
  }));

  assert.equal(plan.shootOut, null);
  assert.ok(plan.actions.some(action => action.includes("Holding fire on lights — will shoot out lamp #0 after 4s")));
});

test("shoots immediately when no dark candidate exists", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "lamp", x: 0, y: 0, intensity: 1, radius: 20, shootable: true }],
    spots: [{ id: "lit", x: 1, y: 0, cover: 0, terrain: "urban" }],
    secondsLit: 0
  }));

  assert.ok(plan.shootOut);
});

test("does not shoot out a light when a threat is within the reveal radius", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "lamp", x: 0, y: 0, intensity: 1, radius: 8, shootable: true }],
    threats: [{ x: 4, y: 0 }],
    secondsLit: 8
  }));

  assert.equal(plan.shootOut, null);
  assert.ok(plan.actions.includes("Too close to 1 threat(s) to shoot out lights — stay mobile"));
});

test("never shoots out a muzzle flash", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "muzzle flash", x: 0, y: 0, intensity: 1, radius: 8, shootable: true }],
    secondsLit: 8
  }));

  assert.equal(plan.shootOut, null);
});

test("tuning can make otherwise unflagged lights shootable", () => {
  const plan = runStealthCircuit(baseScene({
    ambientLight: 0,
    lights: [{ kind: "lamp", x: 0, y: 0, intensity: 1, radius: 8 }],
    secondsLit: 8
  }), { ...DEFAULT_TUNING, lightsShootable: true });

  assert.equal(plan.shootOut?.kind, "lamp");
});

test("light weight and camouflage multiplier adjust exposure", () => {
  const scene = baseScene({
    ambientLight: 0,
    lights: [{ x: 0, y: 0, intensity: 0.6, radius: 10 }]
  });
  const normal = runStealthCircuit(scene);
  const dimmer = runStealthCircuit(scene, { ...DEFAULT_TUNING, lightWeight: 0.5 });
  const strongerCamo = runStealthCircuit(scene, { ...DEFAULT_TUNING, camoMultiplier: 1.25 });

  assert.ok(dimmer.currentExposure < normal.currentExposure);
  assert.ok(strongerCamo.currentExposure < normal.currentExposure);
});

test("lit timer measures continuous exposure and resets when no longer lit", () => {
  const key = "timer-test";

  assert.equal(updateLitTimer(key, true, 1000), 0);
  assert.equal(updateLitTimer(key, true, 3500), 2.5);
  assert.equal(updateLitTimer(key, false, 4000), 0);
  assert.equal(updateLitTimer(key, true, 5000), 0);
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
    lights: [{ x: 0, y: 0, intensity: 2, radius: 1, shootable: true }],
    spots: [{ id: "spot", x: 1, y: 0, cover: -1 }],
    threats: [],
    camo: { pattern: "digital", coverage: 2, terrains: [] },
    secondsLit: 2.5
  });

  assert.equal(parsed?.lights[0].intensity, 1);
  assert.equal(parsed?.lights[0].shootable, true);
  assert.equal(parsed?.spots[0].cover, 0);
  assert.equal(parsed?.camo.coverage, 1);
  assert.equal(parsed?.secondsLit, 2.5);
  assert.equal(parseStealthScene({
    agent: { x: 0, y: 0 },
    lights: [{ x: 0, y: 0, intensity: 1, radius: 1, shootable: "yes" }],
    spots: [],
    threats: [],
    camo: { pattern: "digital", coverage: 0.5, terrains: [] }
  }), undefined);
  assert.equal(parseStealthScene({
    agent: { x: 0, y: 0 },
    lights: [],
    spots: [],
    threats: [],
    camo: { pattern: "digital", coverage: 0.5, terrains: [] },
    secondsLit: -1
  }), undefined);
});
