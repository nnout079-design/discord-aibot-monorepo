import { EndBehaviorType, VoiceConnection, VoiceReceiver, joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";
import { VoiceBasedChannel, TextChannel } from "discord.js";
import prism from "prism-media";
import { transcribeAudio } from "./whisper";

const activeConnections = new Map<string, VoiceConnection>();
const activeUsers = new Set<string>();

function pcmToWav(pcm: Buffer, sampleRate = 48000, channels = 2): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function subscribeToSpeaker(receiver: VoiceReceiver, userId: string, textChannel: TextChannel): void {
  if (activeUsers.has(userId)) return;
  activeUsers.add(userId);

  const opusStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  const chunks: Buffer[] = [];
  opusStream.pipe(decoder);
  decoder.on("data", (chunk: Buffer) => chunks.push(chunk));
  decoder.on("end", async () => {
    activeUsers.delete(userId);
    if (chunks.length === 0) return;
    try {
      const transcript = await transcribeAudio(pcmToWav(Buffer.concat(chunks)));
      if (transcript.trim()) await textChannel.send(`Whisper transcript <@${userId}>: ${transcript}`);
    } catch (error) {
      console.error("Whisper transcription failed:", error);
    }
  });
}

export function startVoiceTranscription(channel: VoiceBasedChannel, textChannel: TextChannel): void {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator
  });
  activeConnections.set(channel.guild.id, connection);
  connection.receiver.speaking.on("start", userId => subscribeToSpeaker(connection.receiver, userId, textChannel));
}

export function stopVoiceTranscription(guildId: string): void {
  const connection = activeConnections.get(guildId) ?? getVoiceConnection(guildId);
  connection?.destroy();
  activeConnections.delete(guildId);
}
