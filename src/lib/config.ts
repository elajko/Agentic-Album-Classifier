export type AiProvider = "anthropic" | "openai";

export interface AppConfig {
  aiProvider: AiProvider;
  anthropicModel: string;
  openaiModel: string;
  /** If a classification's confidence is below this, treat it as "doesn't fit" and mint a new album. */
  classificationThreshold: number;
  /**
   * How far below (threshold + margin) an existing image's confidence must be to be considered
   * "borderline" and eligible for agentic reevaluation when a new album appears.
   */
  reevaluationMargin: number;
  /** Cap on how many borderline images get reevaluated per newly created album, to bound request latency. */
  maxReevaluationsPerRun: number;
  /** Cap on how many Unclassified images get drained per sweep, to bound request latency. */
  maxSweepPerRun: number;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig(): AppConfig {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();

  return {
    aiProvider: provider === "openai" ? "openai" : "anthropic",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    classificationThreshold: envFloat("CLASSIFICATION_THRESHOLD", 0.7),
    reevaluationMargin: envFloat("REEVALUATION_MARGIN", 0.15),
    maxReevaluationsPerRun: envInt("MAX_REEVALUATIONS_PER_RUN", 12),
    maxSweepPerRun: envInt("MAX_SWEEP_PER_RUN", 8),
  };
}
