import { Client, TextChannel } from "discord.js";
import { normalizeTelemetry, updateGameState } from "../gaming/game-state";
import { evaluateGameRules } from "../gaming/rules";
import { sendPushbulletNote } from "../notifications/pushbullet";
import { VehicleDetectionResult } from "./audio-events-client";

let discordClient: Client | undefined;

export function attachVehicleCallbackClient(client: Client): void {
  discordClient = client;
}

interface VehicleCallbackInput {
  guildId: string;
  channelId: string;
  game?: string;
  source: "capture" | "voice";
  userId?: string;
  result: VehicleDetectionResult;
}

async function sendWebhook(input: VehicleCallbackInput): Promise<void> {
  const webhookUrl = process.env.VEHICLE_NOISE_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "vehicle-noise",
        guildId: input.guildId,
        channelId: input.channelId,
        source: input.source,
        userId: input.userId,
        topLabel: input.result.topLabel,
        detections: input.result.detections,
        model: input.result.model,
        detectedAt: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    console.error("Vehicle noise webhook failed:", error);
  }
}

export async function handleVehicleDetection(input: VehicleCallbackInput): Promise<string | null> {
  if (!input.result.isVehicle) return null;

  const topLabel = input.result.topLabel ?? "vehicle";
  const telemetry = normalizeTelemetry({
    guildId: input.guildId,
    channelId: input.channelId,
    game: input.game ?? "unknown",
    event: `vehicle-noise ${topLabel}`,
    analysis: input.result.detections.map(d => `${d.label}:${d.score.toFixed(2)}`).join(", ")
  });
  if (!telemetry) return null;

  const reaction = evaluateGameRules(updateGameState(telemetry));
  await sendWebhook(input);
  if (/siren|emergency|police|ambulance|fire engine/i.test(topLabel)) {
    await sendPushbulletNote({
      title: `${input.game ?? "Game"}: emergency vehicle detected`,
      body: `${topLabel} detected from ${input.source} audio at ${new Date().toISOString()}.`
    }, `vehicle-emergency:${input.guildId}:${topLabel}`, 300_000);
  } else if (/drone|uav|quadcopter|rotorcraft|helicopter|aircraft|jet|propeller|fixed-wing/i.test(topLabel)) {
    await sendPushbulletNote({
      title: `${input.game ?? "Game"}: aerial threat detected`,
      body: `${topLabel} detected from ${input.source} audio at ${new Date().toISOString()}. Watch the sky for drones or flyovers.`
    }, `vehicle-aerial:${input.guildId}:${topLabel}`, 300_000);
  }

  if (reaction && discordClient) {
    try {
      const channel = await discordClient.channels.fetch(reaction.channelId);
      if (channel?.isTextBased()) {
        const who = input.userId ? ` (<@${input.userId}>)` : "";
        await (channel as TextChannel).send(`${reaction.content} Heard **${topLabel}**${who}.`);
      }
    } catch (error) {
      console.error("Vehicle noise Discord callback failed:", error);
    }
  }
  return reaction?.ruleId ?? null;
}
