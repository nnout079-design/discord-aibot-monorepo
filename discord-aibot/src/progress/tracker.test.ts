import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

test("recordActivity + getProgress + getLeaderboard work with file backend", async () => {
  process.env.PROGRESS_DATA_PATH = path.join(os.tmpdir(), `discord-aibot-tracker-${Date.now()}.json`);
  const { recordActivity, getProgress, getLeaderboard } = require("./tracker");

  recordActivity("g1", "u1", "ask", "question");
  recordActivity("g1", "u1", "bertcase", "mask fill");

  await new Promise((resolve) => setTimeout(resolve, 300));

  const progress = await getProgress("g1", "u1");
  assert.equal(progress.xp, 15);
  assert.equal(progress.totals.ask, 1);

  const board = await getLeaderboard("g1");
  assert.equal(board[0].userId, "u1");
});
