import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { HybridReasoner } from "../../reasoning/reasoning";
import { MentalHealthClient } from "../../reasoning/engines/mental-health-client";
import { isCoworker } from "../../security/coworkers";

const reasoner = new HybridReasoner();

function getMentalHealthClient(): MentalHealthClient | undefined {
  const baseUrl = process.env.MENTAL_HEALTH_URL;
  if (!baseUrl) return undefined;
  return new MentalHealthClient({ baseUrl, timeoutMs: 30_000 });
}

export const data = new SlashCommandBuilder()
  .setName("reason")
  .setDescription("Ask Claude a complex question")
  .addStringOption((option) => option.setName("question").setDescription("Your question for Claude").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isCoworker(interaction.user)) {
    await interaction.reply({
      content: "This assistant is available to approved coworkers only.",
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply();

    const question = interaction.options.getString("question", true);

    // Safety guardrail: screen for mental-health distress before sending to Claude.
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
          title: "Mental Health Support",
          color: 0xe74c3c,
          fields: [
            {
              name: "Detected risk level",
              value: `${screening.crisis.severity} (${(screening.crisis.confidence * 100).toFixed(1)}%)`,
            },
            {
              name: "Support resources",
              value:
                screening.triage?.suggested_resources.join("\n") ||
                "Please contact local emergency services or a mental health professional.",
            },
            { name: "Note", value: screening.disclaimer },
          ],
          timestamp: new Date().toISOString(),
        };
        await interaction.editReply({ embeds: [embed] });
        return;
      }
    }

    const result = await reasoner.reason(question);
    const fields = [
      {
        name: "Question",
        value: question.substring(0, 1024),
        inline: false,
      },
      {
        name: "Answer",
        value: result.answer.substring(0, 1024),
        inline: false,
      },
      {
        name: "Type",
        value: result.type,
        inline: true,
      },
      {
        name: "Confidence",
        value: `${(result.confidence * 100).toFixed(0)}%`,
        inline: true,
      },
    ];

    if (result.details?.reasoning) {
      fields.push({
        name: "Reasoning",
        value: String(result.details.reasoning).substring(0, 1024),
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [
        {
          color: result.verified ? 0x00ff00 : 0xffff00,
          title: "Claude Analysis",
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error("Ask command error:", error);
    await interaction.editReply("Error processing your question");
  }
}
