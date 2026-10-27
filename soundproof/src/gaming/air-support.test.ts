import test from "node:test";
import assert from "node:assert/strict";
import { requestAirSupport, abortAirSupport, getAirSupportStatus } from "./air-support";

const guild = () => `g-${Math.random().toString(36).slice(2)}`;

test("dispatch helicopter strike", async () => {
  const gid = guild();
  const result = await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "helicopter",
    mission: "strike",
    requestedBy: "Test",
  });
  assert.equal(result.dispatched, true);
  assert.equal(result.asset?.type, "helicopter");
  assert.equal(result.asset?.status, "inbound");
  assert.ok(result.asset?.callsign.startsWith("Raider"));
  assert.ok(result.message.includes("abort code"));
});

test("dispatch plane strike", async () => {
  const gid = guild();
  const result = await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "plane",
    mission: "strike",
    requestedBy: "Test",
  });
  assert.equal(result.dispatched, true);
  assert.equal(result.asset?.type, "plane");
  assert.ok(result.asset?.callsign.startsWith("Viper"));
});

test("plane cannot fly repair mission", async () => {
  const gid = guild();
  const result = await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "plane",
    mission: "repair",
    requestedBy: "Test",
  });
  assert.equal(result.dispatched, false);
  assert.ok(result.message.includes("cannot fly repair"));
});

test("second dispatch fails when fleet exhausted", async () => {
  const gid = guild();
  await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "helicopter",
    mission: "strike",
    requestedBy: "Test",
  });
  await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "helicopter",
    mission: "strike",
    requestedBy: "Test",
  });
  const third = await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "helicopter",
    mission: "strike",
    requestedBy: "Test",
  });
  assert.equal(third.dispatched, false);
  assert.ok(third.message.includes("No helicopter is ready"));
});

test("abort returns asset to cooldown", async () => {
  const gid = guild();
  const { asset } = await requestAirSupport({
    guildId: gid,
    channelId: "c",
    assetType: "helicopter",
    mission: "strike",
    requestedBy: "Test",
  });
  const result = await abortAirSupport({
    guildId: gid,
    channelId: "c",
    callsign: asset?.callsign,
    requestedBy: "Test",
  });
  assert.equal(result.aborted.length, 1);
  const status = getAirSupportStatus(gid).find((a) => a.callsign === asset?.callsign);
  assert.equal(status?.status, "cooldown");
});

test("air-status shows fleet with payloads and abort codes", async () => {
  const gid = guild();
  const status = getAirSupportStatus(gid);
  assert.equal(status.length, 4);
  assert.ok(status.every((a) => a.abortCode));
  assert.equal(status.filter((a) => a.type === "helicopter").length, 2);
  assert.equal(status.filter((a) => a.type === "plane").length, 2);
});
