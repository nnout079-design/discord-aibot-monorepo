import test from "node:test";
import assert from "node:assert/strict";
import { analyzeArtifact } from "./artifact-analyzer";

function makeZip(paths: string[]): Buffer {
  const entries = paths.map((p) => {
    const name = Buffer.from(p);
    const content = Buffer.from("content");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(0, 42);

    return {
      local: Buffer.concat([localHeader, name, content]),
      central: Buffer.concat([centralHeader, name]),
      size: localHeader.length + name.length + content.length,
    };
  });
  const body = Buffer.concat(entries.map((e) => e.local));
  const central = Buffer.concat(entries.map((e) => e.central));
  const centralOffset = entries.reduce((sum, e) => sum + e.size, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([body, central, eocd]);
}

test("analyzeArtifact detects text and computes entropy", async () => {
  const report = await analyzeArtifact(
    "readme.txt",
    Buffer.from("Hello world! This is a test artifact with some readable content.")
  );
  assert.equal(report.detectedType, "text");
  assert.equal(report.declaredExtension, ".txt");
  assert.ok(report.entropy > 0);
  assert.ok(report.strings.some((s) => s.includes("Hello world")));
  assert.equal(report.recovery.kind, "generic-artifact");
});

test("analyzeArtifact detects PE executable and warns", async () => {
  const buffer = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(60)]);
  const report = await analyzeArtifact("app.exe", buffer);
  assert.equal(report.detectedType, "pe-executable");
  assert.ok(report.warnings.some((w) => w.includes("Executable detected")));
});

test("analyzeArtifact inspects ZIP entries", async () => {
  const zip = makeZip(["config.json", "data.csv"]);
  const report = await analyzeArtifact("backup.zip", zip);
  assert.equal(report.detectedType, "zip");
  assert.equal(report.archive?.entries.length, 2);
  assert.equal(report.archive?.entries[0].path, "config.json");
  assert.ok(report.recovery.restoreOrder.some((s) => s.includes("hash")));
});

test("analyzeArtifact rejects archive with traversal paths", async () => {
  const zip = makeZip(["config.json", "../etc/passwd"]);
  await assert.rejects(() => analyzeArtifact("malicious.zip", zip), /invalid relative path/);
});

test("unsafeArchivePath identifies risky paths", () => {
  const { unsafeArchivePath } = require("./artifact-analyzer");
  assert.equal(unsafeArchivePath("../etc/passwd"), "path traversal");
  assert.equal(unsafeArchivePath("/etc/passwd"), "absolute path");
  assert.equal(unsafeArchivePath("config.json"), undefined);
});

test("analyzeArtifact rejects empty and oversized artifacts", async () => {
  await assert.rejects(() => analyzeArtifact("empty", Buffer.alloc(0)), /empty/);
  await assert.rejects(() => analyzeArtifact("huge", Buffer.alloc(26 * 1024 * 1024)), /exceeds/);
});

test("analyzeArtifact submits sandbox when configured", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "ref-123", status: "queued" }), { status: 200 }) as any;
  try {
    const report = await analyzeArtifact("file.txt", Buffer.from("hello"), {
      sandboxUrl: "https://sandbox.test/submit",
      sandboxToken: "tok",
    });
    assert.equal(report.sandbox?.reference, "ref-123");
    assert.equal(report.sandbox?.status, "queued");
  } finally {
    globalThis.fetch = original;
  }
});

test("analyzeArtifact handles sandbox failure gracefully", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad", { status: 500 }) as any;
  try {
    const report = await analyzeArtifact("file.txt", Buffer.from("hello"), {
      sandboxUrl: "https://sandbox.test/submit",
    });
    assert.ok(report.sandbox?.status.includes("unavailable"));
  } finally {
    globalThis.fetch = original;
  }
});
