import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "./airhorn";

function mockInteraction(subcommand: string) {
  const replies: unknown[] = [];
  return {
    options: { getSubcommand: () => subcommand },
    reply: async (value: unknown) => {
      replies.push(value);
    },
    get replies() {
      return replies;
    },
  } as any;
}

test("/airhorn play replies with airhorn text", async () => {
  const interaction = mockInteraction("play");
  await execute(interaction);
  assert.equal(interaction.replies.length, 1);
  const reply = interaction.replies[0] as string;
  assert.ok(reply.includes("AIRHORN"));
  assert.ok(reply.includes("BEW"));
});

test("/airhorn info replies with an embed", async () => {
  const interaction = mockInteraction("info");
  await execute(interaction);
  assert.equal(interaction.replies.length, 1);
  const reply = interaction.replies[0] as { embeds: any[] };
  assert.ok(reply.embeds);
  assert.equal(reply.embeds[0].title, "📢 Airhorn Bot");
  assert.ok(reply.embeds[0].fields.some((f: any) => f.name === "Version"));
});
