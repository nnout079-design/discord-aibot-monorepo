import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { MentalHealthClient } from "../reasoning/engines/mental-health-client";

export const data = new SlashCommandBuilder()
	.setName("wellness")
	.setDescription("Mental-health analysis and support tools")
	.addSubcommand(subcommand =>
		subcommand
			.setName("check")
			.setDescription("Analyze a message for crisis risk, emotions, and triage level")
			.addStringOption(option => option.setName("message").setDescription("Text to analyze").setRequired(true).setMaxLength(2000))
	)
	.addSubcommand(subcommand =>
		subcommand
			.setName("resources")
			.setDescription("Show mental-health support resources")
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

	if (subcommand === "resources") {
		await interaction.reply({
			content: [
				"**Mental Health Resources**",
				"",
				"988 Suicide & Crisis Lifeline (US): call or text 988",
				"Crisis Text Line (US): text HOME to 741741",
				"SAMHSA National Helpline: 1-800-662-HELP (4357)",
				"Psychology Today therapist finder: psychologytoday.com/us/therapists",
				"NAMI HelpLine: 1-800-950-NAMI (6264)",
				"",
				"If you or someone you know is in immediate danger, please contact local emergency services.",
				"*This bot is not a substitute for professional mental health care.*",
			].join("\n"),
			ephemeral: true,
		});
		return;
	}

	if (subcommand === "check") {
		const message = interaction.options.getString("message", true);
		await interaction.deferReply({ ephemeral: true });

		try {
			const client = getClient();
			const result = await client.analyze(message, {
				includeCrisis: true,
				includeEmotion: true,
				includeTriage: true,
				includeEmbedding: false,
			});

			const summary = client.formatSummary(result);
			await interaction.editReply({ content: summary });
		} catch (error) {
			console.error("Wellness check failed:", error);
			await interaction.editReply({
				content: "Unable to analyze the message right now. If this is an emergency, please contact local emergency services.",
			});
		}
	}
}
