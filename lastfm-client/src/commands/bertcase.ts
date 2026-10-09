import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { MentalHealthClient } from "../reasoning/engines/mental-health-client";

export const data = new SlashCommandBuilder()
	.setName("bertcase")
	.setDescription("Case-aware BERT tools: fill-mask, NER, embeddings, and case style")
	.addSubcommand(subcommand =>
		subcommand
			.setName("fillmask")
			.setDescription("Predict a [MASK] token using a cased BERT model")
			.addStringOption(option => option.setName("text").setDescription("Text with a [MASK] token").setRequired(true).setMaxLength(512)),
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName("entities")
			.setDescription("Extract named entities using a cased BERT NER model")
			.addStringOption(option => option.setName("text").setDescription("Text to analyze").setRequired(true).setMaxLength(512)),
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName("embed")
			.setDescription("Get a case-aware BERT embedding")
			.addStringOption(option => option.setName("text").setDescription("Text to embed").setRequired(true).setMaxLength(512)),
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName("style")
			.setDescription("Detect the case style of text")
			.addStringOption(option => option.setName("text").setDescription("Text to classify").setRequired(true).setMaxLength(2000)),
	);

function getClient(): MentalHealthClient {
	const baseUrl = process.env.MENTAL_HEALTH_URL;
	if (!baseUrl) {
		throw new Error("MENTAL_HEALTH_URL is not configured");
	}
	return new MentalHealthClient({ baseUrl, timeoutMs: 30_000 });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const subcommand = interaction.options.getSubcommand();
	const client = getClient();

	if (subcommand === "fillmask") {
		const text = interaction.options.getString("text", true);
		await interaction.deferReply({ ephemeral: true });
		try {
			const result = await client.fillMask(text, 5);
			const predictions = result.predictions
				.map((p, i) => `${i + 1}. ${p.word} (${(p.score * 100).toFixed(1)}%)`)
				.join("\n");
			await interaction.editReply({
				content: `**Cased BERT fill-mask predictions** (${result.model}):\n${predictions || "No predictions returned."}`,
			});
		} catch (error) {
			console.error("BertCase fill-mask failed:", error);
			await interaction.editReply({ content: "Unable to run fill-mask right now. Make sure the text contains `[MASK]`." });
		}
		return;
	}

	if (subcommand === "entities") {
		const text = interaction.options.getString("text", true);
		await interaction.deferReply({ ephemeral: true });
		try {
			const result = await client.namedEntities(text);
			const entities = result.entities
				.map(e => `• ${e.word} — ${e.label}`)
				.join("\n");
			await interaction.editReply({
				content: `**Named entities** (${result.model}):\n${entities || "No entities detected."}`,
			});
		} catch (error) {
			console.error("BertCase NER failed:", error);
			await interaction.editReply({ content: "Unable to extract entities right now." });
		}
		return;
	}

	if (subcommand === "embed") {
		const text = interaction.options.getString("text", true);
		await interaction.deferReply({ ephemeral: true });
		try {
			const result = await client.caseEmbed(text);
			const preview = result.vector
				? `[${result.vector.slice(0, 3).map(v => v.toFixed(4)).join(", ")}, ...]`
				: "not returned";
			await interaction.editReply({
				content: `**Case-aware embedding** (${result.model}):\nDimensions: ${result.dimensions}\nPreview: ${preview}`,
			});
		} catch (error) {
			console.error("BertCase embed failed:", error);
			await interaction.editReply({ content: "Unable to compute embedding right now." });
		}
		return;
	}

	if (subcommand === "style") {
		const text = interaction.options.getString("text", true);
		await interaction.deferReply({ ephemeral: true });
		try {
			const result = await client.caseStyle(text);
			await interaction.editReply({
				content: [
					`**Detected case style:** ${result.style}`,
					`Letters: ${result.letters} (uppercase: ${result.uppercase}, lowercase: ${result.lowercase})`,
				].join("\n"),
			});
		} catch (error) {
			console.error("BertCase style failed:", error);
			await interaction.editReply({ content: "Unable to classify case style right now." });
		}
		return;
	}
}
