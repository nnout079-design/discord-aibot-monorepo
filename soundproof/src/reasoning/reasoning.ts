import { ClaudeEngine } from "./engines/claude-adapter";

export interface ReasoningResult {
  answer: string;
  type:
    | "math"
    | "set"
    | "logic"
    | "probability"
    | "statistics"
    | "nlp"
    | "graph"
    | "claude"
    | "unknown";
  confidence: number;
  verified: boolean;
  details?: any;
}

export class HybridReasoner {
  private claude: ClaudeEngine;

  constructor() {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error("CLAUDE_API_KEY environment variable not set");
    }
    this.claude = new ClaudeEngine(apiKey);
  }

  async reason(query: string): Promise<ReasoningResult> {
    if (this.claude.isQuery(query)) {
      return this.handleClaude(query);
    }

    return {
      answer: "Unknown",
      type: "unknown",
      confidence: 0,
      verified: false
    };
  }

  private async handleClaude(query: string): Promise<ReasoningResult> {
    try {
      const response = await this.claude.reasonWithThinking(query);
      return {
        answer: response.answer,
        type: "claude",
        confidence: response.confidence,
        verified: true,
        details: { reasoning: response.reasoning }
      };
    } catch (error) {
      console.error("Claude reasoning failed:", error);
      return {
        answer: "Error: Claude reasoning failed",
        type: "claude",
        confidence: 0,
        verified: false
      };
    }
  }
}