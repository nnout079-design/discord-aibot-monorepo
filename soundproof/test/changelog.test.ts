import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTuning,
  fetchChangelogUrl,
  fetchSteamChangelog,
  getOrRefreshTuning,
  getGameTuning,
  KNOWN_STEAM_APPS,
  setGameTuning,
  stripMarkup
} from "../src/gaming/changelog";
import { DEFAULT_TUNING, StealthTuning } from "../src/gaming/stealth-circuit";

const entry = (title: string, text: string) => ({ title, date: "2025-01-01T00:00:00.000Z", text });

test("stripMarkup removes BBCode and HTML tags and collapses whitespace", () => {
  assert.equal(stripMarkup("[b]Bright[/b] <p>lights</p>\n  improved"), "Bright lights improved");
});

test("deriveTuning applies every changelog rule and records bounded source excerpts", () => {
  const entries = [
    entry("Streetlights", "Streetlights can now be shot. Streetlights can now be shot."),
    entry("Lamps", "Lamps are indestructible and can be shot."),
    entry("Lighting", "Lighting increased."),
    entry("Visibility", "Visibility was reduced."),
    entry("Camo", "Camouflage was reduced."),
    entry("Stealth", "Stealth buffed."),
    entry("Gunfire", "Gunfire is louder."),
    entry("Suppressors", "Suppressors make gunshots quieter.")
  ];
  const tuning = deriveTuning(entries);

  assert.equal(tuning.lightsShootable, false);
  assert.equal(tuning.lightWeight, 1.035);
  assert.equal(tuning.camoMultiplier, 0.935);
  assert.equal(tuning.shotRevealRadius, 10);
  assert.equal(tuning.shootOutAfterSeconds, 8);
  assert.deepEqual(new Set(tuning.sources.map(source => source.rule)), new Set([
    "lights-destructible",
    "lights-indestructible",
    "light-buff",
    "light-nerf",
    "camo-nerf",
    "camo-buff",
    "shots-louder",
    "shots-quieter"
  ]));
  assert.equal(tuning.sources.filter(source => source.rule === "lights-destructible").length, 1);
  assert.ok(tuning.sources.every(source => source.excerpt.length <= 160));
  assert.equal(tuning.sources[0].title, "Streetlights");
});

test("indestructible wording takes precedence over destructible wording in a sentence", () => {
  const tuning = deriveTuning([entry("Mixed", "Lights can no longer be shot and are destructible.")]);

  assert.equal(tuning.lightsShootable, false);
  assert.deepEqual(tuning.sources.map(source => source.rule), ["lights-indestructible"]);
});

test("mixed light and camouflage directions are skipped for their subject", () => {
  const tuning = deriveTuning([entry("Mixed", "Lighting is brighter but visibility is reduced. Stealth is buffed but less effective.")]);

  assert.equal(tuning.lightWeight, DEFAULT_TUNING.lightWeight);
  assert.equal(tuning.camoMultiplier, DEFAULT_TUNING.camoMultiplier);
  assert.deepEqual(tuning.sources, []);
});

test("deriveTuning enforces buff and nerf caps and floors", () => {
  const lightBuffs = Array.from({ length: 5 }, (_, index) => entry(`Light buff ${index}`, "Lighting increased."));
  const lightNerfs = Array.from({ length: 10 }, (_, index) => entry(`Light nerf ${index}`, "Visibility reduced."));
  const camoBuffs = Array.from({ length: 5 }, (_, index) => entry(`Camo buff ${index}`, "Stealth improved."));
  const camoNerfs = Array.from({ length: 10 }, (_, index) => entry(`Camo nerf ${index}`, "Camouflage is weaker."));
  const shotBuffs = Array.from({ length: 10 }, (_, index) => entry(`Shot buff ${index}`, "Gunshots are louder."));
  const shotNerfs = Array.from({ length: 20 }, (_, index) => entry(`Shot nerf ${index}`, "Gunfire is quieter."));
  const tuning = deriveTuning([...lightBuffs, ...lightNerfs, ...camoBuffs, ...camoNerfs, ...shotBuffs, ...shotNerfs]);

  assert.equal(tuning.lightWeight, 0.6);
  assert.equal(tuning.camoMultiplier, 0.5);
  assert.equal(tuning.shotRevealRadius, 4);
  assert.equal(tuning.shootOutAfterSeconds, 20);
  const upper = deriveTuning([
    ...lightBuffs,
    ...camoBuffs,
    ...shotBuffs
  ], { ...DEFAULT_TUNING, lightWeight: 1.49, camoMultiplier: 1.29, shotRevealRadius: 28, shootOutAfterSeconds: 19 });
  assert.equal(upper.lightWeight, 1.5);
  assert.equal(upper.camoMultiplier, 1.3);
  assert.equal(upper.shotRevealRadius, 30);
  assert.equal(upper.shootOutAfterSeconds, 20);
});

test("fetchSteamChangelog strips markup and converts Unix dates to ISO", async () => {
  let requestUrl = "";
  let usedTimeout = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    usedTimeout = Boolean(init?.signal);
    return new Response(JSON.stringify({
      appnews: {
        newsitems: [{
          title: "Update",
          contents: "[b]Streetlights[/b] <p>can now be shot.</p>",
          date: 1_700_000_000,
          url: "https://example.test/update"
        }]
      }
    }), { status: 200 });
  };
  const entries = await fetchSteamChangelog(KNOWN_STEAM_APPS["grand theft auto v"], 4, fetchImpl);

  assert.match(requestUrl, /appid=271590&count=4/);
  assert.ok(usedTimeout);
  assert.equal(entries[0].text, "Streetlights can now be shot.");
  assert.equal(entries[0].date, new Date(1_700_000_000 * 1000).toISOString());
});

test("fetchSteamChangelog throws for non-success responses", async () => {
  const fetchImpl: typeof fetch = async () => new Response("", { status: 503 });

  await assert.rejects(fetchSteamChangelog(1, 10, fetchImpl), /503/);
});

test("fetchChangelogUrl rejects non-HTTPS URLs", async () => {
  await assert.rejects(fetchChangelogUrl("http://example.test/changelog", async () => new Response("")));
});

test("game tuning is normalized and returned without exposing the cached object", () => {
  const tuning: StealthTuning = { ...DEFAULT_TUNING, lightWeight: 1.2, sources: [{ title: "test", date: "today", rule: "test", excerpt: "source" }] };
  setGameTuning(" Test Game ", tuning);
  const returned = getGameTuning("test game");
  returned.sources[0].title = "mutated";

  assert.equal(getGameTuning("TEST GAME").sources[0].title, "test");
});

test("getOrRefreshTuning caches successful Steam refreshes and falls back on fetch errors", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ appnews: { newsitems: [] } }), { status: 200 });
  };
  const cached = await getOrRefreshTuning("grand theft auto v", fetchImpl);
  const cachedAgain = await getOrRefreshTuning("GRAND THEFT AUTO V", fetchImpl);

  assert.equal(calls, 1);
  assert.deepEqual(cachedAgain, cached);

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const fallback = await getOrRefreshTuning("counter-strike 2", async () => {
      throw new Error("offline");
    });
    assert.deepEqual(fallback, DEFAULT_TUNING);
  } finally {
    console.warn = originalWarn;
  }
});
