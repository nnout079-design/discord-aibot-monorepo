import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import {
	findGuildEvents,
	findImprovements,
	getLeaderboard,
	getProgress,
	getTier,
	TIERS,
} from "../progress/tracker";

export const data = new SlashCommandBuilder()
	.setName("progress")
	.setDescription("Track your progress and American Psycho-themed rewards")
	.addSubcommand(subcommand =>
		subcommand.setName("status").setDescription("Show your XP, tier, and next reward"))
	.addSubcommand(subcommand =>
		subcommand
			.setName("find")
			.setDescription("Search your improvements (e.g. 'find improvements')")
			.addStringOption(option =>
				option.setName("query").setDescription("What to find — 'improvements', a command name, etc.").setRequired(false)))
	.addSubcommand(subcommand =>
		subcommand.setName("rewards").setDescription("List all reward tiers"))
	.addSubcommand(subcommand =>
		subcommand.setName("card").setDescription("Show your current business card"))
	.addSubcommand(subcommand =>
		subcommand.setName("leaderboard").setDescription("Top cardholders in this server"));

function guildIdOf(interaction: ChatInputCommandInteraction): string {
	return interaction.guildId ?? "dm";
}

function progressBar(xp: number, nextXp: number, prevXp: number): string {
	const span = Math.max(nextXp - prevXp, 1);
	const filled = Math.min(Math.round(((xp - prevXp) / span) * 10), 10);
	return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${xp}/${nextXp}`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const subcommand = interaction.options.getSubcommand();
	const guildId = guildIdOf(interaction);
	const userId = interaction.user.id;
	const progress = await getProgress(guildId, userId);
	const { current, next } = getTier(progress.xp);

	if (subcommand === "status") {
		const lines = [
			`**${interaction.user.username} — Pierce & Pierce standing**`,
			`XP: ${progress.xp}`,
			`Card: **${current.name}**`,
			next ? `Next reward: **${next.name}** at ${next.xp} XP — ${progressBar(progress.xp, next.xp, current.xp)}` : "Top tier reached. Impeccable.",
		];
		const totals = Object.entries(progress.totals)
			.sort((a, b) => b[1] - a[1])
			.map(([action, count]) => `${action}: ${count}`)
			.join(" · ");
		if (totals) {
			lines.push(`Activity: ${totals}`);
		}
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
		return;
	}

	if (subcommand === "find") {
		const query = interaction.options.getString("query") ?? "improvements";
		const improvements = await findImprovements(guildId, userId, query);
		const guildEvents = await findGuildEvents(guildId, query);
		const lines = [`**Find: ${query}**`];
		if (improvements.length === 0 && guildEvents.length === 0) {
			lines.push("Nothing found. I have to return some videotapes.");
		}
		for (const a of improvements) {
			lines.push(`<t:${Math.floor(a.timestamp / 1000)}:R> — \`/${a.action}\` via ${a.bot} (+${a.xp} XP)${a.detail ? ` — ${a.detail}` : ""}`);
		}
		for (const e of guildEvents) {
			lines.push(`<t:${Math.floor(e.timestamp / 1000)}:R> — guild event \`${e.action}\` — ${e.detail}`);
		}
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
		return;
	}

	if (subcommand === "rewards") {
		const lines = ["**Reward tiers — Pierce & Pierce business cards**", ""];
		for (const tier of TIERS) {
			const unlocked = progress.xp >= tier.xp ? "✅" : "🔒";
			lines.push(`${unlocked} **${tier.name}** — ${tier.xp} XP`);
			lines.push(`    *${tier.detail}*`);
		}
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
		return;
	}

	if (subcommand === "card") {
		await interaction.reply({
			content: [
				"```",
				"┌───────────────────────────────────────┐",
				"│  PIERCE & PIERCE                      │",
				`│  ${interaction.user.username.toUpperCase().slice(0, 32).padEnd(32)}     │`,
				"│  Mergers and Acquisitions             │",
				"│                                       │",
				`│  ${current.name.slice(0, 38).padEnd(38)}│`,
				"└───────────────────────────────────────┘",
				"```",
				`*${current.detail}*`,
				next ? `\`${progressBar(progress.xp, next.xp, current.xp)}\` to **${next.name}**` : "",
			].join("\n"),
			ephemeral: true,
		});
		return;
	}

	if (subcommand === "leaderboard") {
		const board = await getLeaderboard(guildId);
		if (board.length === 0) {
			await interaction.reply({ content: "No cardholders yet.", ephemeral: true });
			return;
		}
		const lines = ["**Leaderboard — who has the best card?**"];
		board.forEach((row, i) => {
			const tier = getTier(row.xp).current;
			lines.push(`${i + 1}. <@${row.userId}> — ${row.xp} XP — *${tier.name}*`);
		});
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
	}
}
