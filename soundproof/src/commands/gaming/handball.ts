import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { handballGame, HandballMatch, MatchResult, ThrowOutcome, ZONES, Zone } from "../../gaming/handball";
import { updateGameState } from "../../gaming/game-state";
import { createRankedStore, RankedStore, tierFor } from "../../gaming/ranked";

export const data = new SlashCommandBuilder()
  .setName("handball")
  .setDescription("Handball World: ranked grenade-throw duels")
  .addSubcommand(command => command
    .setName("challenge")
    .setDescription("Challenge another player to a ranked duel")
    .addUserOption(option => option.setName("opponent").setDescription("Player to challenge").setRequired(true))
    .addIntegerOption(option => option.setName("throws").setDescription("Throws per player (3–10)").setMinValue(3).setMaxValue(10)))
  .addSubcommand(command => command.setName("accept").setDescription("Accept your pending challenge"))
  .addSubcommand(command => command.setName("decline").setDescription("Decline or cancel a pending challenge"))
  .addSubcommand(command => command
    .setName("block")
    .setDescription("Set the keeper's hidden block")
    .addStringOption(option => option
      .setName("zone")
      .setDescription("Goal zone to block")
      .setRequired(true)
      .addChoices(...ZONES.map(zone => ({ name: zone, value: zone })))))
  .addSubcommand(command => command
    .setName("throw")
    .setDescription("Throw a grenade at the goal")
    .addStringOption(option => option
      .setName("aim")
      .setDescription("Zone to aim for")
      .setRequired(true)
      .addChoices(...ZONES.map(zone => ({ name: zone, value: zone }))))
    .addIntegerOption(option => option
      .setName("cook")
      .setDescription("Seconds to cook the grenade before throwing (fuse is 2.5–5s)")
      .setMinValue(0)
      .setMaxValue(4)
      .setRequired(true)))
  .addSubcommand(command => command.setName("match").setDescription("Show your current match"))
  .addSubcommand(command => command.setName("forfeit").setDescription("Forfeit your active match"))
  .addSubcommand(command => command
    .setName("rank")
    .setDescription("Show a player's ranked Handball World record")
    .addUserOption(option => option.setName("user").setDescription("Player to inspect")))
  .addSubcommand(command => command.setName("leaderboard").setDescription("Show the top ranked players"))
  .addSubcommand(command => command.setName("rules").setDescription("Explain Handball World mechanics"));

const noMentions = { parse: [] as ("roles" | "users" | "everyone")[] };

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Handball World requires a server.", ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const action = interaction.options.getSubcommand();

  if (action === "challenge") {
    const opponent = interaction.options.getUser("opponent", true);
    const throws = interaction.options.getInteger("throws") ?? 5;
    if (opponent.bot) {
      await errorReply(interaction, "You cannot challenge a bot.");
      return;
    }
    if (opponent.id === userId) {
      await errorReply(interaction, "You cannot challenge yourself.");
      return;
    }
    const created = handballGame.createChallenge(guildId, interaction.channelId, userId, opponent.id, throws);
    if (!created.ok) {
      await errorReply(interaction, created.error);
      return;
    }
    await interaction.reply({
      content: `<@${opponent.id}> — <@${userId}> challenged you to Handball World (${throws} throws each). Use \`/handball accept\` or \`/handball decline\`.`,
      allowedMentions: { users: [opponent.id] }
    });
    return;
  }

  if (action === "accept") {
    const accepted = handballGame.acceptChallenge(guildId, userId);
    if (!accepted.ok) {
      await errorReply(interaction, accepted.error);
      return;
    }
    await publicReply(interaction, `Challenge accepted! <@${accepted.value.players[0]}> throws first. Use \`/handball block\` when you are keeper.`);
    return;
  }

  if (action === "decline") {
    const declined = handballGame.declineChallenge(guildId, userId);
    if (!declined.ok) {
      await errorReply(interaction, declined.error);
      return;
    }
    await publicReply(interaction, "Handball World challenge declined or cancelled.");
    return;
  }

  if (action === "block") {
    const zone = interaction.options.getString("zone", true) as Zone;
    const blocked = handballGame.setBlock(guildId, userId, zone);
    if (!blocked.ok) {
      await errorReply(interaction, blocked.error);
      return;
    }
    await interaction.reply({ content: `Keeper set: ${zone}. Hidden from the thrower.`, ephemeral: true });
    return;
  }

  if (action === "throw") {
    const aim = interaction.options.getString("aim", true) as Zone;
    const cook = interaction.options.getInteger("cook", true);
    const thrown = handballGame.takeThrow(guildId, userId, aim, cook);
    if (!thrown.ok) {
      await errorReply(interaction, thrown.error);
      return;
    }
    const outcome = outcomeText(thrown.value.outcome);
    const matchText = formatScore(thrown.value.match);
    if (thrown.value.result) {
      const rankedLines = await recordMatchResult(interaction, thrown.value.result, "Match finished");
      await publicReply(interaction, `${outcome}\n${matchText}\n${formatResult(thrown.value.result)}${rankedLines}`);
      return;
    }
    const nextThrower = thrown.value.match.players[thrown.value.match.turn];
    await publicReply(interaction, `${outcome}\n${matchText}\nNext throw: <@${nextThrower}>.`);
    return;
  }

  if (action === "match") {
    const match = handballGame.findMatch(guildId, userId);
    if (!match) {
      await interaction.reply({ content: "You are not in an open Handball World match.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: formatMatch(match), ephemeral: true, allowedMentions: noMentions });
    return;
  }

  if (action === "forfeit") {
    const forfeited = handballGame.forfeit(guildId, userId);
    if (!forfeited.ok) {
      await errorReply(interaction, forfeited.error);
      return;
    }
    const rankedLines = await recordMatchResult(interaction, forfeited.value, "Match forfeited");
    await publicReply(interaction, `${formatResult(forfeited.value)}${rankedLines}`);
    return;
  }

  if (action === "rank") {
    const user = interaction.options.getUser("user") ?? interaction.user;
    try {
      const store = await createRankedStore();
      const record = await store.get(guildId, user.id);
      await interaction.reply({
        content: `**${displayName(interaction, user.id)}** — ${record.rating} ${tierFor(record.rating)}\nW ${record.wins} / L ${record.losses} / D ${record.draws}`,
        ephemeral: true,
        allowedMentions: noMentions
      });
    } catch (error) {
      console.error("Handball ranked: failed to read player rank", error);
      await errorReply(interaction, "Rank data is temporarily unavailable.");
    }
    return;
  }

  if (action === "leaderboard") {
    try {
      const store = await createRankedStore();
      const records = await store.leaderboard(guildId, 10);
      const content = records.length
        ? records.map((record, index) => `${index + 1}. **${displayName(interaction, record.userId)}** — ${record.rating} ${tierFor(record.rating)} (W ${record.wins} / L ${record.losses} / D ${record.draws})`).join("\n")
        : "No ranked Handball World matches recorded yet.";
      await interaction.reply({ content, ephemeral: true, allowedMentions: noMentions });
    } catch (error) {
      console.error("Handball ranked: failed to read leaderboard", error);
      await errorReply(interaction, "Rank data is temporarily unavailable.");
    }
    return;
  }

  if (action === "rules") {
    await interaction.reply({
      content: "Challenge a player, then alternate keeper blocks and grenade throws. Cook for 0–4 seconds: a random 2.5–5 second fuse can explode in your hand and score for the keeper. Corner throws can go wide; a correct block can save the throw. First to finish the agreed throws wins on goals, with ties recorded as draws. Matches are ranked with Elo.",
      ephemeral: true
    });
  }
}

async function errorReply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, ephemeral: true });
}

async function publicReply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, allowedMentions: noMentions });
}

function outcomeText(outcome: ThrowOutcome & { throwerId: string; keeperId: string }): string {
  if (outcome.result === "exploded") {
    return `💥 cooked ${outcome.cook}s — fuse was ${outcome.fuse.toFixed(1)}s, exploded in hand! +1 <@${outcome.keeperId}>`;
  }
  if (outcome.result === "goal") {
    return `🥅 GOAL ${outcome.aim} (keeper went ${outcome.block}) +1 <@${outcome.throwerId}>`;
  }
  if (outcome.result === "saved") return `🧤 SAVED ${outcome.aim} (keeper went ${outcome.block})`;
  return `↗️ wide — aimed ${outcome.aim}`;
}

function formatScore(match: HandballMatch): string {
  return `Score: <@${match.players[0]}> ${match.score[0]}–${match.score[1]} <@${match.players[1]}>`;
}

function formatMatch(match: HandballMatch): string {
  const throwsLeft = `${match.players[0]}: ${match.throwsPerPlayer - match.throwsTaken[0]} left, ${match.players[1]}: ${match.throwsPerPlayer - match.throwsTaken[1]} left`;
  if (match.status === "pending") {
    return `Handball World challenge pending.\n${formatScore(match)}\nThrows left — ${throwsLeft}\nTurn: waiting for <@${match.players[1]}> to accept\nKeeper block set: no`;
  }
  const next = match.players[match.turn];
  return `${formatScore(match)}\nThrows left — ${throwsLeft}\nTurn: <@${next}>\nKeeper block set: ${match.pendingBlock ? "yes" : "no"}`;
}

function formatResult(result: MatchResult): string {
  if (result.draw) return `Handball World match is a draw. Final ${formatScore(result.match)}.`;
  return `Handball World: <@${result.winnerId}> wins! Final ${formatScore(result.match)}.`;
}

async function recordMatchResult(
  interaction: ChatInputCommandInteraction,
  result: MatchResult,
  summary: string
): Promise<string> {
  const { match } = result;
  const scoreA = result.draw ? 0.5 : result.winnerId === match.players[0] ? 1 : 0;
  let ratingLines = "\nRank update unavailable.";
  try {
    const store: RankedStore = await createRankedStore();
    const changes = await store.recordResult(match.guildId, match.players[0], match.players[1], scoreA);
    ratingLines = `\n${displayName(interaction, match.players[0])}: ${changes.a.before} → ${changes.a.after} (${tierFor(changes.a.after)})` +
      `\n${displayName(interaction, match.players[1])}: ${changes.b.before} → ${changes.b.after} (${tierFor(changes.b.after)})`;
  } catch (error) {
    console.error("Handball ranked: failed to record match result", error);
  }
  updateGameState({
    guildId: match.guildId,
    channelId: match.channelId,
    game: "handball world",
    phase: "victory",
    event: "ranked-match-end",
    players: 2,
    analysis: summary,
    observedAt: new Date().toISOString()
  });
  return ratingLines;
}

function displayName(interaction: ChatInputCommandInteraction, userId: string): string {
  return interaction.guild?.members.cache.get(userId)?.displayName ??
    interaction.client.users.cache.get(userId)?.username ??
    userId;
}
