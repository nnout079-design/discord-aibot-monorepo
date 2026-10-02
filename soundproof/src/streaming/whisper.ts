import OpenAI, { toFile } from "openai";

export async function transcribeAudio(audio: Buffer, filename = "discord-audio.wav"): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({ apiKey });
  const result = await client.audio.transcriptions.create({
    file: await toFile(audio, filename),
    model: "whisper-1"
  });
  return result.text;
}
