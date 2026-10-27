import assert from "node:assert/strict";
import test from "node:test";
import { HandballGame, resolveThrow } from "../src/gaming/handball";

test("resolveThrow explodes when the grenade is cooked through its fuse", () => {
  const outcome = resolveThrow("top-left", "center", 4, () => 0);

  assert.equal(outcome.result, "exploded");
  assert.equal(outcome.fuse, 2.5);
  assert.equal(outcome.cook, 4);
});

test("resolveThrow can go wide on a corner throw", () => {
  const values = [0.5, 0.05];
  const outcome = resolveThrow("bottom-right", "center", 0, () => values.shift()!);

  assert.equal(outcome.result, "wide");
});

test("resolveThrow saves a throw when the keeper guesses correctly", () => {
  const values = [0.5, 0.5, 0.5];
  const outcome = resolveThrow("top-right", "top-right", 0, () => values.shift()!);

  assert.equal(outcome.result, "saved");
  assert.equal(outcome.saveChance, 0.85);
});

test("resolveThrow scores when the keeper guesses incorrectly", () => {
  const values = [0.5, 0.5];
  const outcome = resolveThrow("top-right", "bottom-left", 0, () => values.shift()!);

  assert.equal(outcome.result, "goal");
  assert.equal(outcome.saveChance, 0);
});

test("center throws never go wide and still consume the wide random draw", () => {
  let calls = 0;
  const outcome = resolveThrow("center", "top-left", 0, () => {
    calls += 1;
    return 0;
  });

  assert.equal(outcome.result, "goal");
  assert.equal(calls, 2);
});

test("save chance has a 0.15 floor at maximum cook", () => {
  const values = [0.9, 0.5, 0.14];
  const outcome = resolveThrow("center", "center", 4, () => values.shift()!);

  assert.equal(outcome.result, "saved");
  assert.equal(outcome.saveChance, 0.15);
});

test("match alternates throws and blocks, clears the block, and defaults to center", () => {
  const game = new HandballGame();
  const created = game.createChallenge("guild", "channel", "a", "b", 3);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const accepted = game.acceptChallenge("guild", "b");
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.value.turn, 0);

  const outOfTurn = game.takeThrow("guild", "b", "top-left", 0);
  assert.equal(outOfTurn.ok, false);

  const blocked = game.setBlock("guild", "b", "bottom-left");
  assert.equal(blocked.ok, true);
  const first = game.takeThrow("guild", "a", "top-right", 0, () => 0.5);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.outcome.block, "bottom-left");
  assert.equal(first.value.match.pendingBlock, undefined);
  assert.equal(first.value.match.turn, 1);

  const second = game.takeThrow("guild", "b", "top-left", 0, () => 0.5);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.outcome.block, "center");
  assert.equal(second.value.match.turn, 0);
});

test("an exploded throw scores for the keeper", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b", 3);
  game.acceptChallenge("guild", "b");

  const thrown = game.takeThrow("guild", "a", "top-left", 4, () => 0);

  assert.equal(thrown.ok, true);
  if (!thrown.ok) return;
  assert.equal(thrown.value.outcome.result, "exploded");
  assert.deepEqual(thrown.value.match.score, [0, 1]);
});

test("a completed match returns the winner after each player takes all throws", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b", 3);
  game.acceptChallenge("guild", "b");
  let finished: ReturnType<HandballGame["takeThrow"]> = game.takeThrow("guild", "a", "top-left", 0, () => 0.5);

  for (let throwNumber = 0; throwNumber < 3; throwNumber += 1) {
    const bValues = [0.5, 0.05];
    finished = game.takeThrow("guild", "b", "bottom-right", 0, () => bValues.shift()!);
    assert.equal(finished.ok, true);
    if (!finished.ok) return;
    if (throwNumber === 2) {
      assert.equal(finished.value.result?.winnerId, "a");
      assert.equal(finished.value.result?.match.status, "finished");
      assert.deepEqual(finished.value.match.throwsTaken, [3, 3]);
    } else {
      finished = game.takeThrow("guild", "a", "top-left", 0, () => 0.5);
      assert.equal(finished.ok, true);
    }
  }
});

test("a completed match can be a draw", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b", 3);
  game.acceptChallenge("guild", "b");
  let result;

  for (let throwNumber = 0; throwNumber < 3; throwNumber += 1) {
    game.takeThrow("guild", "a", "top-left", 0, () => 0.5);
    const bValues = [0.5, 0.5];
    const thrown = game.takeThrow("guild", "b", "bottom-right", 0, () => bValues.shift()!);
    if (throwNumber === 2 && thrown.ok) result = thrown.value.result;
  }

  assert.equal(result?.draw, true);
  assert.equal(result?.winnerId, null);
});

test("self-challenges and players with an existing match are rejected", () => {
  const game = new HandballGame();
  assert.equal(game.createChallenge("guild", "channel", "a", "a").ok, false);
  assert.equal(game.createChallenge("guild", "channel", "a", "b").ok, true);
  assert.equal(game.createChallenge("guild", "channel", "c", "a").ok, false);
});

test("only the challenged player can accept and either player can decline", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b");

  assert.equal(game.acceptChallenge("guild", "a").ok, false);
  assert.equal(game.acceptChallenge("guild", "c").ok, false);
  const declined = game.declineChallenge("guild", "a");

  assert.equal(declined.ok, true);
  assert.equal(game.findMatch("guild", "a"), undefined);
});

test("pending challenges expire after five minutes and no longer block players", () => {
  const game = new HandballGame();
  const now = Date.now();
  game.createChallenge("guild", "channel", "a", "b", 5, now);

  const expired = game.expireStale(now + 5 * 60 * 1000 + 1);

  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, "expired");
  assert.equal(game.createChallenge("guild", "channel", "a", "c", 5, now + 5 * 60 * 1000 + 2).ok, true);
});

test("forfeit awards the result to the other player", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b");
  game.acceptChallenge("guild", "b");

  const result = game.forfeit("guild", "a");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.winnerId, "b");
  assert.equal(result.value.loserId, "a");
  assert.equal(result.value.match.status, "forfeited");
  assert.equal(result.value.match.forfeitedBy, "a");
});

test("setBlock only accepts a keeper in an active match", () => {
  const game = new HandballGame();
  game.createChallenge("guild", "channel", "a", "b");

  const pendingBlock = game.setBlock("guild", "b", "center");
  assert.equal(pendingBlock.ok, false);
  game.acceptChallenge("guild", "b");
  assert.equal(game.setBlock("guild", "a", "center").ok, false);
  assert.equal(game.setBlock("guild", "b", "center").ok, true);
});
