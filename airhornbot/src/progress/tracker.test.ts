import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

test("getTier resolves correct reward tier", () => {
  process.env.PROGRESS_DATA_PATH = path.join(os.tmpdir(), `airhorn-tracker-${Date.now()}.json`);
  const { getTier } = require("./tracker");
  assert.equal(getTier(0).current.name, "Silian Rail on Bone");
  assert.equal(getTier(24).next?.name, "Romalian Type on Eggshell");
  assert.equal(getTier(200).current.name, "Tasteful Thickness, Subtle Off-White, Watermark");
  assert.equal(getTier(10000).current.name, "Impeccable");
});

test("recordActivity + getProgress stores xp, totals and activities", async () => {
  process.env.PROGRESS_DATA_PATH = path.join(os.tmpdir(), `airhorn-tracker-${Date.now()}.json`);
  delete require.cache[require.resolve("./tracker")];
  const { recordActivity, getProgress } = require("./tracker");

  recordActivity("g1", "u1", "airhorn", "loud noise");
  recordActivity("g1", "u1", "bertcase", "masked query");
  recordActivity("g1", "u1", "listen", "track share");

  await new Promise((resolve) => setTimeout(resolve, 300));

  const progress = await getProgress("g1", "u1");
  assert.equal(progress.xp, 13);
  assert.equal(progress.totals.airhorn, 1);
  assert.equal(progress.totals.bertcase, 1);
  assert.equal(progress.totals.listen, 1);
  assert.equal(progress.activities.length, 3);
});

test("getLeaderboard ranks users by xp", async () => {
  process.env.PROGRESS_DATA_PATH = path.join(os.tmpdir(), `airhorn-tracker-${Date.now()}.json`);
  delete require.cache[require.resolve("./tracker")];
  const { recordActivity, getLeaderboard } = require("./tracker");

  recordActivity("g2", "alice", "airhorn");
  recordActivity("g2", "alice", "listen");
  recordActivity("g2", "bob", "bertcase");

  await new Promise((resolve) => setTimeout(resolve, 300));

  const board = await getLeaderboard("g2");
  assert.equal(board[0].userId, "alice");
  assert.equal(board[0].xp, 8);
  assert.equal(board[1].userId, "bob");
});
