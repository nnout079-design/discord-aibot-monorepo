import Anthropic from "@anthropic-ai/sdk";
export interface ClaudeResponse { answer: string; reasoning: string; confidence: number; }
export class ClaudeEngine {
  private client: Anthropic;
  private model = "claude-opus-4-1";
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey }); }
  async query(prompt: string): Promise<ClaudeResponse> {
    try {
      const message = await this.client.messages.create({
        model: this.model, max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const answer = message.content[0].type === "text" ? message.content[0].text : "";
      return { answer, reasoning: "", confidence: 0.9 };
    } catch (error) { console.error("Claude API error:", error); throw error; }
  }
  async reasonWithThinking(prompt: string): Promise<ClaudeResponse> {
    try {
      const systemPrompt = `You are a helpful AI assistant. When answering: think step by step, consider perspectives, provide reasoning. Format as: THINKING: [steps] ANSWER: [answer]`;
      const message = await this.client.messages.create({
        model: this.model, max_tokens: 2048, system: systemPrompt,
        messages: [{ role: "user", content: prompt }]
      });
      const content = message.content[0].type === "text" ? message.content[0].text : "";
      const thinkingMatch = content.match(/THINKING:\s*([\s\S]*?)(?=ANSWER:|$)/);
      const answerMatch = content.match(/ANSWER:\s*([\s\S]*?)$/);
      const reasoning = thinkingMatch ? thinkingMatch[1].trim() : "";
      const answer = answerMatch ? answerMatch[1].trim() : content;
      return { answer, reasoning, confidence: 0.92 };
    } catch (error) { console.error("Claude reasoning error:", error); throw error; }
  }
  isQuery(text: string): boolean {
    const patterns = [/explain|describe|analyze|summarize|think|reason/i, /what.*think|how.*work|why/i];
    return patterns.some(p => p.test(text));
  }
}
