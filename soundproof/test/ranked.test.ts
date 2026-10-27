import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eloUpdate, FileRankedStore, tierFor } from "../src/gaming/ranked";

test("Elo updates ratings for wins and draws", () => {
  assert.deepEqual(eloUpdate(1000, 1000, 1), { a: 1016, b: 984 });
  assert.deepEqual(eloUpdate(1000, 1000, 0.5), { a: 1000, b: 1000 });
});

test("rank tiers respect their rating boundaries", () => {
  assert.equal(tierFor(1099), "Bronze");
  assert.equal(tierFor(1100), "Silver");
  assert.equal(tierFor(1250), "Gold");
  assert.equal(tierFor(1700), "Grenadier");
});

test("file store persists ratings, records, and a sorted leaderboard", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "handball-ranked-"));
  const filePath = path.join(directory, "ranked.json");
  try {
    const store = new FileRankedStore(filePath);
    const firstWin = await store.recordResult("guild", "a", "b", 1);
    assert.deepEqual([firstWin.a.before, firstWin.a.after], [1000, 1016]);
    await store.recordResult("guild", "a", "b", 0.5);
    await store.recordResult("guild", "a", "b", 0);

    const restored = new FileRankedStore(filePath);
    const a = await restored.get("guild", "a");
    const b = await restored.get("guild", "b");
    assert.deepEqual(a, await store.get("guild", "a"));
    assert.deepEqual([a.wins, a.losses, a.draws], [1, 1, 1]);
    assert.deepEqual([b.wins, b.losses, b.draws], [1, 1, 1]);

    const leaderboard = await restored.leaderboard("guild");
    assert.deepEqual(leaderboard.map(record => record.userId), ["b", "a"]);
    assert.ok(leaderboard[0].rating > leaderboard[1].rating);
    assert.deepEqual(leaderboard[0], b);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file store treats corrupt JSON as an empty store", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "handball-ranked-corrupt-"));
  const filePath = path.join(directory, "ranked.json");
  try {
    writeFileSync(filePath, "{not json", "utf8");
    const store = new FileRankedStore(filePath);
    const record = await store.get("guild", "user");
    assert.equal(record.userId, "user");
    assert.equal(record.rating, 1000);
    assert.equal(record.wins, 0);
    assert.equal(record.losses, 0);
    assert.equal(record.draws, 0);
    assert.deepEqual(await store.leaderboard("guild"), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
