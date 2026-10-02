import express, { Request, Response } from "express";
import OpenAI from "openai";
import { Client, TextChannel } from "discord.js";
import { detectGameFromText } from "../gaming/epic";
import { normalizeTelemetry, updateGameState } from "../gaming/game-state";
import { evaluateGameRules } from "../gaming/rules";
import { fetchStarCitizenTelemetry } from "../gaming/star-citizen";

export interface VideoFrame {
  guildId: string;
  channelId: string;
  capturedAt: string;
  imageBase64: string;
  analysis?: string;
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
              { type: "text", text: "Briefly describe only visible gameplay or safety-relevant details in this Discord gaming frame." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]
          }],
          max_tokens: 160
        });
        latestFrame.analysis = result.choices[0]?.message.content ?? "";
      } catch (error) {
        console.error("OpenAI frame analysis failed:", error);
      }
    }
    const detectedText = latestFrame.analysis ?? "";
    const telemetry = normalizeTelemetry({
      guildId,
      channelId,
      game: (request.body as { game?: string }).game ?? detectGameFromText(detectedText),
      phase: (request.body as { phase?: "lobby" | "match" | "victory" | "defeat" }).phase,
      event: (request.body as { event?: string }).event ?? detectedText,
      analysis: detectedText
    });
    const reaction = telemetry ? evaluateGameRules(updateGameState(telemetry)) : undefined;
    if (reaction && discordClient) {
      const channel = await discordClient.channels.fetch(reaction.channelId);
      if (channel?.isTextBased()) await (channel as TextChannel).send(reaction.content);
    }
    response.status(202).json({ accepted: true, capturedAt: latestFrame.capturedAt, rule: reaction?.ruleId ?? null });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Companion ingest listening on port ${port}`));
}
