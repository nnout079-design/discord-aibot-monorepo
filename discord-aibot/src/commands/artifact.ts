import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { analyzeArtifact } from "../analysis/artifact-analyzer";

const MAX_BYTES = 25 * 1024 * 1024;

export const data = new SlashCommandBuilder()
	.setName("artifact")
	.setDescription("Defensively inspect an authorized backup or application artifact")
	.addAttachmentOption(option => option.setName("file").setDescription("Authorized artifact to inspect without execution").setRequired(true))
	.addBooleanOption(option => option.setName("authorized").setDescription("Confirm you own or are authorized to inspect this artifact").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	if (!interaction.options.getBoolean("authorized", true)) {
		await interaction.reply({ content: "Analysis requires explicit authorization confirmation.", ephemeral: true });
		return;
	}
	const attachment = interaction.options.getAttachment("file", true);
	if (attachment.size > MAX_BYTES) {
		await interaction.reply({ content: "Artifact exceeds the 25 MiB analysis limit.", ephemeral: true });
		return;
	}
	await interaction.deferReply({ ephemeral: true });
	try {
		const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
		if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
		const contentLength = Number(response.headers.get("content-length") ?? 0);
		if (contentLength > MAX_BYTES) throw new Error("Artifact exceeds the 25 MiB analysis limit");
		const buffer = Buffer.from(await response.arrayBuffer());
		const report = await analyzeArtifact(attachment.name, buffer, {
			maxBytes: MAX_BYTES,
			sandboxUrl: process.env.ARTIFACT_SANDBOX_URL,
			sandboxToken: process.env.ARTIFACT_SANDBOX_TOKEN,
		});
		const unsafeEntries = report.archive?.entries.filter(entry => entry.risk).length ?? 0;
		const summary = [
			`**Type:** ${report.detectedType}`,
			`**Size:** ${report.size.toLocaleString()} bytes`,
			`**SHA-256:** \`${report.sha256}\``,
			`**Entropy:** ${report.entropy} bits/byte`,
			`**Recovery kind:** ${report.recovery.kind}`,
			...(report.archive ? [`**Archive:** ${report.archive.entries.length} entries, ${report.archive.totalUncompressedSize.toLocaleString()} expanded bytes`] : []),
			...(unsafeEntries ? [`**Unsafe archive paths:** ${unsafeEntries}`] : []),
			`**Restore order:**\n${report.recovery.restoreOrder.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
			...(report.warnings.length ? [`**Warnings:**\n${report.warnings.map(value => `- ${value}`).join("\n")}`] : []),
			...(report.sandbox ? [`**Sandbox:** ${report.sandbox.status}`] : []),
		].join("\n");
		await interaction.editReply({ content: summary.slice(0, 2_000) });
	} catch (error) {
		console.error("Artifact analysis failed:", error);
		await interaction.editReply({ content: `Analysis failed: ${error instanceof Error ? error.message : "unknown error"}` });
	}
}
