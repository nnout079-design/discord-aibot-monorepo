import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { MentalHealthClient } from "../reasoning/engines/mental-health-client";
import { ClaudeEngine } from "../reasoning/engines/claude-adapter";

export const data = new SlashCommandBuilder()
	.setName("ask")
	.setDescription("Ask Claude AI a question")
	.addStringOption(option => option.setName("question").setDescription("Your question for Claude").setRequired(true).setMaxLength(500))
	.addBooleanOption(option => option.setName("thinking").setDescription("Show Claude's reasoning process").setRequired(false));

function getMentalHealthClient(): MentalHealthClient | undefined {
	const baseUrl = process.env.MENTAL_HEALTH_URL;
	if (!baseUrl) return undefined;
	return new MentalHealthClient({ baseUrl, timeoutMs: 30_000 });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const question = interaction.options.getString("question", true);
	const showThinking = interaction.options.getBoolean("thinking") || false;

	const apiKey = process.env.CLAUDE_API_KEY;
	if (!apiKey) {
		await interaction.reply({ content: "Claude API key not configured. Please set CLAUDE_API_KEY environment variable.", ephemeral: true });
		return;
	}

	await interaction.deferReply();

	try {
		// Safety guardrail: screen the question for mental-health distress before
		// sending it to the general-purpose LLM.
		const mentalHealth = getMentalHealthClient();
		if (mentalHealth) {
			const screening = await mentalHealth.analyze(question, {
				includeCrisis: true,
				includeEmotion: true,
				includeTriage: true,
				includeEmbedding: false,
			});

			if (screening.crisis?.is_crisis) {
				const embed = {
					title: "🛟 Mental Health Support",
					color: 0xe74c3c,
					fields: [
						{ name: "Detected risk level", value: `${screening.crisis.severity} (${(screening.crisis.confidence * 100).toFixed(1)}%)` },
						{ name: "Support resources", value: screening.triage?.suggested_resources.join("\n") || "Please contact local emergency services or a mental health professional." },
						{ name: "Note", value: screening.disclaimer },
					],
					timestamp: new Date().toISOString()
				};
				await interaction.editReply({ embeds: [embed] });
				return;
			}
		}

		const claude = new ClaudeEngine(apiKey);
		let response;

		if (showThinking) {
			response = await claude.reasonWithThinking(question);
			const embed = {
				title: "🤖 Claude Response",
				fields: [
					{ name: "Question", value: question },
					{ name: "Thinking Process", value: response.reasoning || "No reasoning provided" },
					{ name: "Answer", value: response.answer }
				],
				timestamp: new Date().toISOString()
			};
			await interaction.editReply({ embeds: [embed] });
		} else {
			response = await claude.query(question);
			const embed = {
				title: "🤖 Claude Response",
				fields: [
					{ name: "Question", value: question },
					{ name: "Answer", value: response.answer }
				],
				timestamp: new Date().toISOString()
			};
			await interaction.editReply({ embeds: [embed] });
		}
	} catch (error) {
		console.error("Claude API or mental-health service error:", error);
		await interaction.editReply({ content: "Error processing your request. Please try again later." });
	}
}
