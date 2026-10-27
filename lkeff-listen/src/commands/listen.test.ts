import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "./listen";

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

test("/listen info replies with an embed", async () => {
  const interaction = mockInteraction("info");
  await execute(interaction);
  assert.equal(interaction.replies.length, 1);
  const reply = interaction.replies[0] as { embeds: any[] };
  assert.ok(reply.embeds);
  assert.equal(reply.embeds[0].title, "🎵 Listen Bot");
});

test("/listen status replies with a status embed", async () => {
  const interaction = mockInteraction("status");
  await execute(interaction);
  const reply = interaction.replies[0] as { embeds: any[] };
  assert.ok(reply.embeds[0].fields.some((f: any) => f.name === "Latency"));
});
