import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getEpicGameLink, epicConfigurationStatus } from "../../gaming/epic";
import { getGameState, updateGameState } from "../../gaming/game-state";
import { listRules } from "../../gaming/rules";
import { fetchStarCitizenTelemetry } from "../../gaming/star-citizen";
import { analyzeDeath, getDiagnosticSummary, requestReaInvestigation } from "../../gaming/diagnostics";
import { getPushbulletStatus, sendPushbulletNote } from "../../notifications/pushbullet";
import { isCoworker } from "../../security/coworkers";

export const data = new SlashCommandBuilder()
  .setName("game")
  .setDescription("Inspect and control the game reaction engine")
  .addSubcommand(command => command
    .setName("launch")
    .setDescription("Prepare an Epic Games launch link")
    .addStringOption(option => option.setName("game").setDescription("Epic app slug or game identifier").setRequired(true)))
  .addSubcommand(command => command.setName("status").setDescription("Show the current game telemetry state"))
  .addSubcommand(command => command.setName("rules").setDescription("List active game reaction rules"))
  .addSubcommand(command => command.setName("diagnostics").setDescription("Summarize streaming, AI, telemetry, and bot failures"))
  .addSubcommand(command => command.setName("postmortem").setDescription("Analyze the latest death and prepare a safer next attempt"))
  .addSubcommand(command => command.setName("notifications").setDescription("Check the Pushbullet notification connection"))
  .addSubcommand(command => command.setName("push-test").setDescription("Send a Pushbullet test notification"))
  .addSubcommand(command => command.setName("rea-review").setDescription("Submit redacted diagnostics to configured REA providers"))
  .addSubcommand(command => command.setName("star-citizen").setDescription("Fetch Star Citizen API telemetry"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isCoworker(interaction.user)) {
    await interaction.reply({ content: "This command is available to approved coworkers only.", ephemeral: true });
    return;
  }

  const action = interaction.options.getSubcommand();
  if (action === "launch") {
    const game = interaction.options.getString("game", true);
    const link = getEpicGameLink(game);
    await interaction.reply({ content: `${epicConfigurationStatus()}\nLaunch locally with: \`${link.launchUri}\``, ephemeral: true });
    return;
  }

  if (action === "rules") {
    const summary = listRules().map(rule => `• ${rule.id}: ${rule.response}`).join("\n");
    await interaction.reply({ content: summary, ephemeral: true });
    return;
  }

  if (action === "notifications" || action === "push-test") {
    await interaction.deferReply({ ephemeral: true });
    if (action === "push-test") {
      const result = await sendPushbulletNote({ title: "Soundproof gaming companion", body: "Pushbullet notifications are connected." });
      await interaction.editReply({ content: `Pushbullet test: ${result.status}.` });
      return;
    }
    const status = await getPushbulletStatus();
    await interaction.editReply({ content: status.connected ? `Pushbullet connected${status.account ? ` for ${status.account}` : ""}.` : `Pushbullet unavailable: ${status.error ?? "not configured"}.` });
    return;
  }

  if (action === "postmortem") {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Gaming postmortems require a Discord server.", ephemeral: true });
      return;
    }
    const postmortem = analyzeDeath(interaction.guildId);
    await interaction.reply({
      content: postmortem.detected
        ? [
          `Likely cause: ${postmortem.cause} (${(postmortem.confidence * 100).toFixed(0)}% evidence confidence)`,
          `Cycle risk: ${postmortem.cycleRisk}${postmortem.repeatedPattern ? ` — ${postmortem.repeatedPattern}` : ""}`,
          `Preparation: ${postmortem.preparation.join(" ")}`,
          `Unknowns: ${postmortem.unknowns.join(" ")}`
        ].join("\n").slice(0, 2000)
        : postmortem.cause,
      ephemeral: true
    });
    return;
  }

  if (action === "diagnostics" || action === "rea-review") {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Gaming diagnostics require a Discord server.", ephemeral: true });
      return;
    }
    const summary = getDiagnosticSummary(interaction.guildId);
    if (action === "rea-review") {
      await interaction.deferReply({ ephemeral: true });
      const providers = await requestReaInvestigation(interaction.guildId);
      await interaction.editReply({ content: providers.map(item => `${item.provider}: ${item.status}${item.reference ? ` (${item.reference})` : ""}`).join("\n") });
      return;
    }
    const accuracy = summary.accuracy === undefined ? "no feedback" : `${(summary.accuracy * 100).toFixed(1)}%`;
    await interaction.reply({
      content: [
        `Evidence: ${summary.total} | failures: ${summary.failures} | degraded: ${summary.degraded}`,
        `Average latency: ${summary.averageLatencyMs} ms | feedback accuracy: ${accuracy}`,
        `Likely causes: ${summary.likelyCauses.join("; ") || "none yet"}`,
        `Recommendations: ${summary.recommendations.join(" ")}`
      ].join("\n").slice(0, 2000),
      ephemeral: true
    });
    return;
  }

  if (action === "star-citizen") {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({ content: "Star Citizen telemetry requires a server channel.", ephemeral: true });
      return;
    }
    try {
      const telemetry = await fetchStarCitizenTelemetry(interaction.guildId, interaction.channelId);
      updateGameState(telemetry);
      await interaction.reply({
        content: `Star Citizen: ${telemetry.event}\nPhase: ${telemetry.phase}\nLocation: ${telemetry.analysis || "unknown"}`,
        ephemeral: true
      });
    } catch (error) {
      console.error("Star Citizen telemetry failed:", error);
      await interaction.reply({ content: "Star Citizen API is not configured or unavailable.", ephemeral: true });
    }
    return;
  }

  const state = interaction.guildId ? getGameState(interaction.guildId) : undefined;
  await interaction.reply({
    content: state
      ? `Game: ${state.game}\nPhase: ${state.phase}\nEvent: ${state.event}\nPlayers: ${state.players ?? "unknown"}\nUpdated: ${state.updatedAt}`
      : "No game telemetry has been received for this server.",
    ephemeral: true
  });
}
