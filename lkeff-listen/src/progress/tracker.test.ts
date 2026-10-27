import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

test("recordActivity + getProgress + getLeaderboard work with file backend", async () => {
  process.env.PROGRESS_DATA_PATH = path.join(os.tmpdir(), `lkeff-tracker-${Date.now()}.json`);
  const { recordActivity, getProgress, getLeaderboard } = require("./tracker");

  recordActivity("g1", "u1", "listen", "track share");
  recordActivity("g1", "u1", "lastfm", "another track");

  await new Promise((resolve) => setTimeout(resolve, 300));

  const progress = await getProgress("g1", "u1");
  assert.equal(progress.xp, 10);
  assert.equal(progress.totals.listen, 1);
  assert.equal(progress.totals.lastfm, 1);

  const board = await getLeaderboard("g1");
  assert.equal(board[0].userId, "u1");
});
