import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getGameTuning, refreshGameTuning } from "../../gaming/changelog";
import {
  DEMO_SCENE,
  DEFAULT_TUNING,
  formatStealthPlan,
  getLastStealthPlan,
  runStealthCircuit
} from "../../gaming/stealth-circuit";

export const data = new SlashCommandBuilder()
  .setName("stealth")
  .setDescription("Stealth circuit: avoid light, full camouflage")
  .addSubcommand(command => command.setName("plan").setDescription("Show the latest stealth plan for this server"))
  .addSubcommand(command => command.setName("demo")
    .setDescription("Run the example stealth circuit")
    .addStringOption(option => option.setName("game").setDescription("Use tuning learned for a game")))
  .addSubcommand(command => command.setName("changelog")
    .setDescription("Refresh stealth tuning from a game changelog")
    .addStringOption(option => option.setName("game").setDescription("Game name").setRequired(true))
    .addIntegerOption(option => option.setName("appid").setDescription("Steam app ID").setMinValue(1))
    .addStringOption(option => option.setName("url").setDescription("HTTPS changelog URL")))
  .addSubcommand(command => command.setName("rules").setDescription("Explain the stealth circuit model"));

const noMentions = { parse: [] as ("roles" | "users" | "everyone")[] };

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getSubcommand();
  if (action === "plan") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Stealth plans are scoped to a server. POST a scene to `/stream/stealth` to create one.",
        ephemeral: true,
        allowedMentions: noMentions
      });
      return;
    }
    const last = getLastStealthPlan(interaction.guildId);
    if (!last) {
      await interaction.reply({
        content: "No stealth plan yet. POST a scene to `/stream/stealth` to create one.",
        ephemeral: true,
        allowedMentions: noMentions
      });
      return;
    }
    await interaction.reply({
      content: `${formatStealthPlan(last.plan)}\nLast updated: ${last.at}`,
      allowedMentions: noMentions
    });
    return;
  }

  if (action === "changelog") {
    await interaction.deferReply();
    const game = interaction.options.getString("game", true);
    const appId = interaction.options.getInteger("appid") ?? undefined;
    const url = interaction.options.getString("url") ?? undefined;
    try {
      const tuning = await refreshGameTuning(game, {
        ...(appId !== undefined ? { appId } : {}),
        ...(url ? { url } : {})
      });
      const sources = tuning.sources.slice(0, 5).map(source => `${source.title} — ${source.rule}: ${source.excerpt}`);
      const content = [
        `**Stealth tuning — ${game}**`,
        `Light weight: ${tuning.lightWeight.toFixed(2)}`,
        `Camouflage multiplier: ${tuning.camoMultiplier.toFixed(2)}`,
        `Lights shootable: ${tuning.lightsShootable ?? false}`,
        `Shoot-out delay: ${tuning.shootOutAfterSeconds}s`,
        `Shot reveal radius: ${tuning.shotRevealRadius}m`,
        sources.length ? `Sources:\n${sources.join("\n")}` : "Sources: none matched"
      ].join("\n");
      await interaction.editReply({ content, allowedMentions: noMentions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        content: `Couldn't read changelog: ${message}`,
        allowedMentions: noMentions
      });
    }
    return;
  }

  if (action === "demo") {
    const game = interaction.options.getString("game");
    const tuning = game ? getGameTuning(game) : DEFAULT_TUNING;
    await interaction.reply({
      content: formatStealthPlan(runStealthCircuit(DEMO_SCENE, tuning)),
      allowedMentions: noMentions
    });
    return;
  }

  if (action === "rules") {
    await interaction.reply({
      content: "The stealth circuit estimates light exposure, camouflage fit, cover, movement, and nearby threats. It prefers dark cover with a safer route, recommends full camouflage, and lowers risk by holding still once hidden.",
      ephemeral: true,
      allowedMentions: noMentions
    });
  }
}
