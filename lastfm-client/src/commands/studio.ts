import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { createLastFmApi } from "../lastfm/api";
import { defaultGeminiAgent, formatQuota, QuotaExceededError, VideoInflictionPlan } from "../reasoning/engines/gemini-adapter";
import { enrichTrack } from "../sync/enrich";
import { TrackAttributes } from "../sync/entry";
import { nowPlaying, trackInfo } from "../sync/session";

export const data = new SlashCommandBuilder()
  .setName("studio")
  .setDescription("Studio video infliction: genre + situationship diagnosis for colliding videos")
  .addSubcommand(sub => sub
    .setName("diagnose")
    .setDescription("Diagnose how two videos should be inflicted on each other for a song")
    .addStringOption(o => o.setName("song").setDescription('"Artist - Title" (or leave empty and give a Last.fm user)').setMaxLength(200))
    .addStringOption(o => o.setName("user").setDescription("Last.fm username: use their now playing").setMaxLength(100))
    .addStringOption(o => o.setName("video_a").setDescription("What video A shows").setMaxLength(300))
    .addStringOption(o => o.setName("video_b").setDescription("What video B shows").setMaxLength(300))
    .addBooleanOption(o => o.setName("original_sound").setDescription("Keep the original song audio (default on)")))
  .addSubcommand(sub => sub.setName("quota").setDescription("How many studio diagnoses you have left"));

async function findTrack(song: string | null, user: string | null): Promise<TrackAttributes> {
  const api = createLastFmApi();
  if (song) {
    const dash = song.indexOf(" - ");
    if (dash <= 0) throw new Error('song must look like "Artist - Title"');
    const artist = song.slice(0, dash).trim();
    const name = song.slice(dash + 3).trim();
    return api ? trackInfo(api, artist, name) : enrichTrack(null, { name, artist, tags: [] });
  }
  if (!user) throw new Error("Give a song or a Last.fm user");
  if (!api) throw new Error("Last.fm API is not configured on the bot");
  return nowPlaying(api, user);
}

const quoted = (value: string) => `"${value.replace(/"/g, "'")}"`;

export function formatDiagnosis(track: TrackAttributes, plan: VideoInflictionPlan, quota: string): string {
  const { genre, situationship: s } = plan;
  const c = s.inflictionChoreography;
  return [
    `**${track.artist} - ${track.name}**`,
    `**Genre:** ${genre.primaryGenre} (${genre.subgenres.join(", ")}) | energy ${Math.round(genre.energy * 100)}% | palette ${genre.aestheticPalette.join(" ")}`,
    `**Situationship:** ${s.headline} (\`${s.type}\`, ${s.dissonanceScore}% dissonance)`,
    `> ${s.narrativeDiagnosis}`,
    `**Infliction:** \`${c.blendMode}\` every ${c.collisionRate.replace("_", " ")}, opacity ${c.opacityRange.join("-")}${c.stutterGlitch ? ", strobe on snare/clap" : ""}`,
    `**HUD:** ${c.hudBadge}`,
    `Diagnosed by ${plan.source === "gemini" ? plan.model : "heuristic fallback"} | quota ${quota}`,
    "",
    `Render on your PC: \`npm run studio inflict ${quoted(`song=${track.artist} - ${track.name}`)} videos=A.mp4,B.mp4${plan.originalSound ? "" : " original=0"}\``
  ].join("\n").slice(0, 2000);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const bypassQuota = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  const quotaManager = defaultGeminiAgent.quotaManager;
  if (interaction.options.getSubcommand() === "quota") {
    await interaction.reply({ content: `Studio diagnoses: ${formatQuota(quotaManager.checkQuota(interaction.user.id, bypassQuota))}`, ephemeral: true });
    return;
  }
  const status = quotaManager.checkQuota(interaction.user.id, bypassQuota);
  if (!status.allowed) {
    await interaction.reply({ content: `Quota reached: ${formatQuota(status)}. Try again <t:${Math.ceil(status.resetAt / 1000)}:R>.`, ephemeral: true });
    return;
  }
  await interaction.deferReply();
  let track: TrackAttributes;
  try {
    track = await findTrack(interaction.options.getString("song"), interaction.options.getString("user"));
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : "Could not find that song");
    return;
  }
  const videos = [interaction.options.getString("video_a"), interaction.options.getString("video_b")].filter((v): v is string => Boolean(v));
  try {
    const originalSound = interaction.options.getBoolean("original_sound") ?? true;
    const { diagnosis, quota } = await defaultGeminiAgent.diagnose(track, videos, interaction.user.id, { originalSound, videoOnly: true, bypassQuota });
    await interaction.editReply(formatDiagnosis(track, diagnosis, formatQuota(quota)));
  } catch (error) {
    if (!(error instanceof QuotaExceededError)) throw error;
    await interaction.editReply(`Quota reached: ${formatQuota(error.quota)}. Try again <t:${Math.ceil(error.quota.resetAt / 1000)}:R>.`);
  }
}
