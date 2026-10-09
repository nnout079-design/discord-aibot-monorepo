export interface EmotionLabel {
  label: string;
  score: number;
}

export interface CrisisResult {
  label: string;
  confidence: number;
  severity: "low" | "moderate" | "high" | "critical";
  is_crisis: boolean;
}

export interface EmotionResult {
  top_emotions: EmotionLabel[];
  all_scores?: Record<string, number>;
}

export interface TriageResult {
  level: string;
  urgency: string;
  suggested_resources: string[];
  reasoning: string;
}

export interface EmbeddingResult {
  model: string;
  dimensions: number;
  vector?: number[];
}

export interface FillMaskPrediction {
  token: string;
  word: string;
  score: number;
}

export interface FillMaskResult {
  model: string;
  predictions: FillMaskPrediction[];
}

export interface Entity {
  word: string;
  label: string;
  score?: number;
}

export interface NERResult {
  model: string;
  entities: Entity[];
}

export interface CaseStyleResult {
  style: string;
  letters: number;
  uppercase: number;
  lowercase: number;
  confidence: number;
}

export interface AnalyzeOptions {
  includeCrisis?: boolean;
  includeEmotion?: boolean;
  includeTriage?: boolean;
  includeEmbedding?: boolean;
}

export interface AnalyzeResponse {
  text_excerpt: string;
  crisis?: CrisisResult;
  emotion?: EmotionResult;
  triage?: TriageResult;
  embedding?: EmbeddingResult;
  safety_message?: string;
  disclaimer: string;
}

export interface HealthResponse {
  status: string;
  loaded_models: string[];
}

export interface MentalHealthClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * HTTP client for the mental-health inference microservice.
 *
 * All methods return structured results so bot code can decide how to respond
 * without knowing anything about the underlying transformer models.
 */
export class MentalHealthClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: MentalHealthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new Error(`Mental-health service returned ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Mental-health service health check failed: ${response.status}`);
    }
    return (await response.json()) as HealthResponse;
  }

  async analyze(text: string, options: AnalyzeOptions = {}): Promise<AnalyzeResponse> {
    return this.post<AnalyzeResponse>("/analyze", {
      text,
      include_crisis: options.includeCrisis ?? true,
      include_emotion: options.includeEmotion ?? true,
      include_triage: options.includeTriage ?? true,
      include_embedding: options.includeEmbedding ?? false,
    });
  }

  async detectCrisis(text: string): Promise<CrisisResult> {
    return this.post<CrisisResult>("/crisis", { text });
  }

  async classifyEmotion(text: string): Promise<EmotionResult> {
    return this.post<EmotionResult>("/emotion", { text });
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.post<EmbeddingResult>("/embed", { text });
  }

  async fillMask(text: string, topK = 5): Promise<FillMaskResult> {
    return this.post<FillMaskResult>("/bertcase/fillmask", { text, top_k: topK });
  }

  async namedEntities(text: string): Promise<NERResult> {
    return this.post<NERResult>("/bertcase/ner", { text });
  }

  async caseEmbed(text: string): Promise<EmbeddingResult> {
    return this.post<EmbeddingResult>("/bertcase/embed", { text });
  }

  async caseStyle(text: string): Promise<CaseStyleResult> {
    return this.post<CaseStyleResult>("/bertcase/style", { text });
  }

  async triage(text: string): Promise<TriageResult> {
    const result = await this.analyze(text, {
      includeCrisis: true,
      includeEmotion: true,
      includeTriage: true,
      includeEmbedding: false,
    });
    if (!result.triage) {
      throw new Error("Triage result missing from mental-health service");
    }
    return result.triage;
  }

  /**
   * Convenience helper for bot commands: returns a compact, Discord-safe summary.
   */
  formatSummary(result: AnalyzeResponse): string {
    const lines: string[] = [];

    if (result.crisis) {
      lines.push(
        `**Crisis risk:** ${result.crisis.label} (${(result.crisis.confidence * 100).toFixed(1)}%) — severity: ${result.crisis.severity}`,
      );
    }

    if (result.emotion?.top_emotions?.length) {
      const emotions = result.emotion.top_emotions
        .slice(0, 5)
        .map((e) => `${e.label} ${(e.score * 100).toFixed(0)}%`)
        .join(", ");
      lines.push(`**Top emotions:** ${emotions}`);
    }

    if (result.triage) {
      lines.push(`**Triage level:** ${result.triage.level} (${result.triage.urgency})`);
    }

    if (result.safety_message) {
      lines.push("", result.safety_message);
    }

    lines.push("", `*${result.disclaimer}*`);
    return lines.join("\n");
  }
}
