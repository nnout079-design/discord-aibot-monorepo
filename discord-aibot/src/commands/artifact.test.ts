import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "./artifact";

function mockInteraction(authorized: boolean, attachment?: { name: string; size: number; url: string }) {
  const replies: unknown[] = [];
  const edits: unknown[] = [];
  return {
    options: {
      getBoolean: () => authorized,
      getAttachment: () => attachment,
    },
    deferReply: async () => {
      edits.push("deferred");
    },
    reply: async (value: unknown) => {
      replies.push(value);
    },
    editReply: async (value: unknown) => {
      edits.push(value);
    },
    get replies() {
      return replies;
    },
    get edits() {
      return edits;
    },
  } as any;
}

test("artifact command rejects unauthorized submissions", async () => {
  const interaction = mockInteraction(false);
  await execute(interaction);
  assert.equal(interaction.replies.length, 1);
  assert.ok((interaction.replies[0] as any).content.includes("authorization"));
});

test("artifact command rejects oversized attachments", async () => {
  const interaction = mockInteraction(true, {
    name: "big.zip",
    size: 30 * 1024 * 1024,
    url: "http://example.com/big.zip",
  });
  await execute(interaction);
  assert.equal(interaction.replies.length, 1);
  assert.ok((interaction.replies[0] as any).content.includes("exceeds"));
});

test("artifact command analyzes small attachments", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from("plain text artifact"), { status: 200 }) as any;
  try {
    const interaction = mockInteraction(true, { name: "small.txt", size: 100, url: "http://example.com/small.txt" });
    await execute(interaction);
    assert.equal(interaction.edits.length, 2);
    const last = interaction.edits[1] as { content: string };
    assert.ok(last.content.includes("text"));
    assert.ok(last.content.includes("SHA-256"));
  } finally {
    globalThis.fetch = original;
  }
});
