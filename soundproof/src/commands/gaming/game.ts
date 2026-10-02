import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getEpicGameLink, epicConfigurationStatus } from "../../gaming/epic";
import { getGameState, updateGameState } from "../../gaming/game-state";
import { listRules } from "../../gaming/rules";
import { fetchStarCitizenTelemetry } from "../../gaming/star-citizen";
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
