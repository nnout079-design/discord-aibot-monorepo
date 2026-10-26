import express, { Request, Response } from "express";
import OpenAI from "openai";
import { Client, TextChannel } from "discord.js";
import { detectGameFromText } from "../gaming/epic";
import { normalizeTelemetry, updateGameState } from "../gaming/game-state";
import { evaluateGameRules } from "../gaming/rules";
import { fetchStarCitizenTelemetry } from "../gaming/star-citizen";
import { analyzeDeath, getDiagnosticSummary, hashObservation, recordDiagnostic, recordDiagnosticFeedback, requestReaInvestigation } from "../gaming/diagnostics";
import { sendPushbulletNote } from "../notifications/pushbullet";
import { parseStealthScene, recordStealthPlan, runStealthCircuit } from "../gaming/stealth-circuit";
import { detectVehicleNoise } from "./audio-events-client";
import { handleVehicleDetection } from "./vehicle-callback";

export interface VideoFrame {
  guildId: string;
  channelId: string;
  capturedAt: string;
  imageBase64: string;
  analysis?: string;
}

export interface AudioClip {
  guildId: string;
  channelId: string;
  audioBase64: string;
  game?: string;
}

let latestFrame: VideoFrame | undefined;
let discordClient: Client | undefined;

export function attachGameReactionClient(client: Client): void {
  discordClient = client;
}

export function startCompanionServer(): void {
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_request: Request, response: Response) => {
    response.json({ ok: true, latestFrameAt: latestFrame?.capturedAt ?? null });
  });

  app.get("/stream/star-citizen/status", async (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const guildId = String(request.query.guildId ?? "");
    const channelId = String(request.query.channelId ?? "");
    if (!guildId || !channelId) {
      response.status(400).json({ error: "guildId and channelId are required" });
      return;
    }
    try {
      const telemetry = await fetchStarCitizenTelemetry(guildId, channelId);
      const reaction = evaluateGameRules(updateGameState(telemetry));
      if (reaction && discordClient) {
        const channel = await discordClient.channels.fetch(reaction.channelId);
        if (channel?.isTextBased()) await (channel as TextChannel).send(reaction.content);
      }
      response.json({ telemetry, rule: reaction?.ruleId ?? null });
    } catch (error) {
      console.error("Star Citizen status fetch failed:", error);
      response.status(502).json({ error: "star citizen source unavailable" });
    }
  });

  app.post("/stream/frame", async (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }

    const { guildId, channelId, imageBase64 } = request.body as Partial<VideoFrame>;
    if (!guildId || !channelId || !imageBase64) {
      response.status(400).json({ error: "guildId, channelId, and imageBase64 are required" });
      return;
    }

    const startedAt = Date.now();
    const requestedGame = (request.body as { game?: string }).game ?? "unknown";
    const contentHash = hashObservation(imageBase64);
    latestFrame = { guildId, channelId, imageBase64, capturedAt: new Date().toISOString() };
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const client = new OpenAI({ apiKey });
        const result = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Briefly describe only visible gameplay or safety-relevant details in this Discord gaming frame, explicitly naming visible drones, UAVs, aircraft, NPC enemies, or AI-controlled hostile units when present. State uncertainty; do not infer hidden game state." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]
          }],
          max_tokens: 160
        });
        latestFrame.analysis = result.choices[0]?.message.content ?? "";
        recordDiagnostic({ guildId, channelId, game: requestedGame, source: "frame", stage: "vision", outcome: latestFrame.analysis ? "ok" : "degraded", latencyMs: Date.now() - startedAt, contentHash, detail: latestFrame.analysis ? "Frame description produced" : "Vision returned no description" });
      } catch (error) {
        console.error("OpenAI frame analysis failed:", error);
        recordDiagnostic({ guildId, channelId, game: requestedGame, source: "frame", stage: "vision", outcome: "failed", latencyMs: Date.now() - startedAt, contentHash, detail: error instanceof Error ? error.message : "Vision analysis failed" });
      }
    } else {
      recordDiagnostic({ guildId, channelId, game: requestedGame, source: "frame", stage: "vision", outcome: "skipped", latencyMs: 0, contentHash, detail: "OPENAI_API_KEY is not configured" });
    }
    const detectedText = latestFrame.analysis ?? "";
    const game = requestedGame === "unknown" ? detectGameFromText(detectedText) : requestedGame;
    const telemetry = normalizeTelemetry({
      guildId,
      channelId,
      game,
      phase: (request.body as { phase?: "lobby" | "match" | "victory" | "defeat" }).phase,
      event: (request.body as { event?: string }).event ?? detectedText,
      analysis: detectedText
    });
    if (!telemetry) {
      const evidence = recordDiagnostic({ guildId, channelId, game, source: "frame", stage: "telemetry", outcome: "failed", latencyMs: Date.now() - startedAt, contentHash, detail: "Missing or empty game/event after normalization" });
      response.status(202).json({ accepted: true, capturedAt: latestFrame.capturedAt, rule: null, evidenceId: evidence.id, diagnostic: "telemetry-not-produced" });
      return;
    }
    const reaction = evaluateGameRules(updateGameState(telemetry));
    const evidence = recordDiagnostic({ guildId, channelId, game: telemetry.game, source: "frame", stage: "rules", outcome: reaction ? "ok" : "degraded", latencyMs: Date.now() - startedAt, event: telemetry.event, ruleId: reaction?.ruleId, contentHash, detail: reaction ? "Rule matched" : "No rule matched or rule was on cooldown" });
    if (reaction && discordClient) {
      try {
        const channel = await discordClient.channels.fetch(reaction.channelId);
        if (channel?.isTextBased()) await (channel as TextChannel).send(reaction.content);
        else recordDiagnostic({ guildId, channelId, game: telemetry.game, source: "frame", stage: "discord", outcome: "failed", event: telemetry.event, ruleId: reaction.ruleId, detail: "Destination is not a text channel" });
      } catch (error) {
        recordDiagnostic({ guildId, channelId, game: telemetry.game, source: "frame", stage: "discord", outcome: "failed", event: telemetry.event, ruleId: reaction.ruleId, detail: error instanceof Error ? error.message : "Discord send failed" });
      }
    }
    const postmortem = /died|death|defeat|eliminated|wasted|busted|killed|downed|game over/i.test(`${telemetry.event} ${telemetry.analysis ?? ""}`)
      ? analyzeDeath(guildId, evidence.id)
      : undefined;
    const notification = postmortem?.detected
      ? await sendPushbulletNote({
        title: `${telemetry.game}: death postmortem`,
        body: [`Likely cause: ${postmortem.cause}`, `Cycle risk: ${postmortem.cycleRisk}`, ...postmortem.preparation].join("\n")
      }, `death:${guildId}:${postmortem.cause}`)
      : undefined;
    const threatNotification = reaction?.ruleId.startsWith("threat-")
      ? await sendPushbulletNote({
        title: `${telemetry.game}: threat detected`,
        body: `${reaction.content}\nEvidence: ${(telemetry.analysis ?? telemetry.event).slice(0, 400)}`
      }, `threat:${guildId}:${reaction.ruleId}`, 300_000)
      : undefined;
    response.status(202).json({ accepted: true, capturedAt: latestFrame.capturedAt, rule: reaction?.ruleId ?? null, evidenceId: evidence.id, ...(postmortem ? { postmortem } : {}), ...(notification ? { notification: notification.status } : {}), ...(threatNotification ? { threatNotification: threatNotification.status } : {}) });
  });

  app.post("/stream/stealth", async (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }

    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as { guildId?: unknown; channelId?: unknown; game?: unknown; scene?: unknown }
      : {};
    const guildId = typeof body.guildId === "string" ? body.guildId : "";
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const scene = parseStealthScene(body.scene);
    if (!guildId || !channelId || !scene) {
      response.status(400).json({ error: "guildId, channelId, and a valid scene are required" });
      return;
    }

    const plan = runStealthCircuit(scene);
    recordStealthPlan(guildId, plan);
    const game = typeof body.game === "string" ? body.game : "unknown";
    const state = updateGameState({
      guildId,
      channelId,
      game: game.trim().toLowerCase(),
      phase: "match",
      event: "stealth-plan",
      analysis: `risk ${plan.risk} exposure ${plan.currentExposure}`,
      observedAt: new Date().toISOString()
    });
    const reaction = evaluateGameRules(state);
    if (reaction && discordClient) {
      const channel = await discordClient.channels.fetch(reaction.channelId);
      if (channel?.isTextBased()) await (channel as TextChannel).send(reaction.content);
    }
    response.json({ plan, rule: reaction?.ruleId ?? null });
  });

  app.post("/stream/audio", async (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }

    const { guildId, channelId, audioBase64, game } = request.body as Partial<AudioClip>;
    if (!guildId || !channelId || !audioBase64) {
      response.status(400).json({ error: "guildId, channelId, and audioBase64 are required" });
      return;
    }

    const startedAt = Date.now();
    const contentHash = hashObservation(audioBase64);
    try {
      const result = await detectVehicleNoise(Buffer.from(audioBase64, "base64"));
      if (!result) {
        const evidence = recordDiagnostic({ guildId, channelId, game: game ?? "unknown", source: "audio", stage: "audio", outcome: "skipped", latencyMs: Date.now() - startedAt, contentHash, detail: "Audio-events service is not configured" });
        response.status(503).json({ error: "audio-events service is not configured", evidenceId: evidence.id });
        return;
      }
      const ruleId = await handleVehicleDetection({
        guildId,
        channelId,
        game,
        source: "capture",
        result
      });
      const evidence = recordDiagnostic({ guildId, channelId, game: game ?? "unknown", source: "audio", stage: "audio", outcome: result.detections.length ? "ok" : "degraded", latencyMs: Date.now() - startedAt, event: result.topLabel ?? "no-detection", ruleId: ruleId ?? undefined, confidence: result.detections[0]?.score, contentHash, detail: result.detections.length ? "Audio classification completed" : "No audio event exceeded the threshold" });
      response.status(202).json({
        accepted: true,
        isVehicle: result.isVehicle,
        topLabel: result.topLabel,
        detections: result.detections,
        rule: ruleId,
        evidenceId: evidence.id
      });
    } catch (error) {
      console.error("Vehicle noise detection failed:", error);
      const evidence = recordDiagnostic({ guildId, channelId, game: game ?? "unknown", source: "audio", stage: "audio", outcome: "failed", latencyMs: Date.now() - startedAt, contentHash, detail: error instanceof Error ? error.message : "Audio analysis failed" });
      response.status(502).json({ error: "audio-events service unavailable", evidenceId: evidence.id });
    }
  });

  app.get("/stream/diagnostics", (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const guildId = String(request.query.guildId ?? "");
    if (!guildId) {
      response.status(400).json({ error: "guildId is required" });
      return;
    }
    response.json(getDiagnosticSummary(guildId, Number(request.query.limit ?? 25)));
  });

  app.post("/stream/feedback", (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const { evidenceId, correct, expectedEvent, note } = request.body as { evidenceId?: string; correct?: boolean; expectedEvent?: string; note?: string };
    if (!evidenceId || typeof correct !== "boolean") {
      response.status(400).json({ error: "evidenceId and correct are required" });
      return;
    }
    if (!recordDiagnosticFeedback({ evidenceId, correct, expectedEvent, note })) {
      response.status(404).json({ error: "evidence not found" });
      return;
    }
    response.status(202).json({ accepted: true });
  });

  app.get("/stream/postmortem", (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const guildId = String(request.query.guildId ?? "");
    if (!guildId) {
      response.status(400).json({ error: "guildId is required" });
      return;
    }
    response.json(analyzeDeath(guildId, request.query.evidenceId ? String(request.query.evidenceId) : undefined));
  });

  app.post("/stream/diagnostics/rea", async (request: Request, response: Response) => {
    const expectedToken = process.env.STREAM_INGEST_TOKEN;
    if (!expectedToken || request.header("x-stream-token") !== expectedToken) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const guildId = String(request.body?.guildId ?? "");
    if (!guildId || request.body?.authorized !== true) {
      response.status(400).json({ error: "guildId and authorized=true are required" });
      return;
    }
    response.status(202).json({ providers: await requestReaInvestigation(guildId) });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Companion ingest listening on port ${port}`));
}
