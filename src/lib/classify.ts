import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AiProvider, AppConfig } from "./config";
import type { Album, ImageRecord, Schema } from "./types";
import { slugifyAlbumName, UNCLASSIFIED_ALBUM } from "./types";

/**
 * Thrown instead of a raw provider error when the API itself rejects the key (401/403) - as
 * opposed to network blips, rate limits, or model overload, which should just be a generic
 * failure. There's no separate "is my key still valid" ping; this is only ever discovered as a
 * side effect of a real classification call (i.e. when a file is actually uploaded).
 */
export class ProviderAuthError extends Error {
  constructor(
    public readonly provider: AiProvider,
    cause: unknown
  ) {
    super(`The ${provider} API key was rejected (expired, revoked, or invalid).`);
    this.name = "ProviderAuthError";
    this.cause = cause;
  }
}

function isAuthFailure(err: unknown): boolean {
  return APICallError.isInstance(err) && (err.statusCode === 401 || err.statusCode === 403);
}

const classificationSchema = z.object({
  decision: z
    .enum(["existing", "new"])
    .describe(
      "'existing' if the image clearly fits one of the candidate albums, 'new' if none of them fit well."
    ),
  label: z
    .string()
    .describe(
      "If decision is 'existing', this must be exactly one of the candidate album names given in the prompt. " +
        "If decision is 'new', a short, human-friendly title for a brand-new album (2-4 words, title case)."
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Confidence (0-1) that the image belongs in `label`. For a 'new' decision this is your confidence " +
        "that this new theme accurately captures the image."
    ),
  description: z
    .string()
    .describe(
      "A one-sentence description of the album's theme. Used verbatim as the classification anchor for " +
        "future images, so make it specific enough to distinguish this album from the others."
    ),
  reasoning: z.string().describe("One brief sentence explaining the decision."),
});

export type ClassificationResult = z.infer<typeof classificationSchema>;

function getModel(config: AppConfig, apiKey: string): LanguageModel {
  return config.aiProvider === "openai"
    ? createOpenAI({ apiKey })(config.openaiModel)
    : createAnthropic({ apiKey })(config.anthropicModel);
}

function inferMediaType(url: string): string {
  const ext = url.split(".").pop()?.toLowerCase().split("?")[0];
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

function describeAlbums(albums: Album[]): string {
  if (albums.length === 0) return "(none yet - this is the first image)";

  return albums
    .map((album) => `- "${album.title}": ${album.description}`)
    .join("\n");
}

/**
 * Zero-shot classifies a single image against the current set of albums using a
 * vision-capable LLM, standing in for the CLIP-based classifier in the original app.
 * The model is trusted to decide both the best-fit existing album AND, agentically,
 * whether none of them fit well enough to warrant a brand-new album.
 */
export async function classifyImage(params: {
  imageUrl: string;
  albums: Album[];
  config: AppConfig;
  apiKey: string;
}): Promise<ClassificationResult> {
  const { imageUrl, albums, config, apiKey } = params;

  try {
    const { object } = await generateObject({
      model: getModel(config, apiKey),
      schema: classificationSchema,
      system:
        "You are the sorting agent for a photo album app. You maintain a small set of albums " +
        "(each with a short description) and decide which album each new image belongs to. " +
        "Prefer an existing album whenever the image genuinely fits its theme. Only propose a new " +
        `album when the image doesn't fit any existing album with at least ${config.classificationThreshold} confidence. ` +
        "Keep album titles short and general enough to plausibly hold future similar images, not " +
        "hyper-specific to this one photo.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Existing albums:\n${describeAlbums(albums)}\n\n` +
                "Classify the attached image against these albums.",
            },
            {
              type: "file",
              data: new URL(imageUrl),
              mediaType: inferMediaType(imageUrl),
            },
          ],
        },
      ],
    });

    return object;
  } catch (err) {
    if (isAuthFailure(err)) throw new ProviderAuthError(config.aiProvider, err);
    throw err;
  }
}

function uniqueAlbumName(desiredTitle: string, existing: Record<string, Album>): {
  name: string;
  title: string;
} {
  const baseSlug = slugifyAlbumName(desiredTitle);
  let name = baseSlug;
  let suffix = 2;

  while (existing[name]) {
    name = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return { name, title: desiredTitle };
}

/**
 * Turns a raw classification result into a final album, minting a new album in the schema
 * when nothing existing fit well enough (README's "agentic album creation" feature).
 */
function resolveAlbumForResult(
  result: ClassificationResult,
  schema: Schema,
  config: AppConfig
): { label: string; createdNewAlbum: boolean } {
  const candidateSlug = slugifyAlbumName(result.label);

  const fitsExisting =
    result.decision === "existing" &&
    candidateSlug !== UNCLASSIFIED_ALBUM &&
    schema.albums[candidateSlug] !== undefined &&
    result.confidence >= config.classificationThreshold;

  if (fitsExisting) {
    return { label: candidateSlug, createdNewAlbum: false };
  }

  const { name, title } = uniqueAlbumName(result.label, schema.albums);

  schema.albums[name] = {
    name,
    title,
    description: result.description,
    pinned: false,
    createdAt: new Date().toISOString(),
  };

  return { label: name, createdNewAlbum: true };
}

/**
 * Runs the full agentic filing step for one newly-uploaded image: classify it, mint a new
 * album if nothing fits well, file the image, and then reevaluate other borderline images in
 * case the new album is a better home for them (README's agentic features). Mutates and
 * returns the schema.
 */
export async function classifyAndFile(params: {
  schema: Schema;
  imageUrl: string;
  filename: string;
  config: AppConfig;
  apiKey: string;
}): Promise<{ schema: Schema; label: string; createdNewAlbum: boolean }> {
  const { schema, imageUrl, filename, config, apiKey } = params;
  const albums = Object.values(schema.albums).filter((a) => a.name !== UNCLASSIFIED_ALBUM);

  const result = await classifyImage({ imageUrl, albums, config, apiKey });
  const { label, createdNewAlbum } = resolveAlbumForResult(result, schema, config);

  const record: ImageRecord = {
    filename,
    url: imageUrl,
    label,
    confidence: result.confidence,
    uploadedAt: new Date().toISOString(),
  };

  schema.images[filename] = record;

  if (createdNewAlbum) {
    await reevaluateBorderlineImages({ schema, config, apiKey, newAlbumName: label, justFiled: filename });
  }

  pruneEmptyAlbums(schema);

  return { schema, label, createdNewAlbum };
}

/**
 * Agentic reevaluation: whenever a new album appears, images that were previously filed with
 * low confidence might actually belong there instead. Re-classifies a bounded set of the most
 * borderline existing images against the updated album set and moves them if the new album is a
 * strictly better fit. Images still sitting in the Unclassified bucket are handled separately by
 * `sweepUnclassified` instead, so they don't crowd out this batch.
 */
export async function reevaluateBorderlineImages(params: {
  schema: Schema;
  config: AppConfig;
  apiKey: string;
  newAlbumName: string;
  justFiled?: string;
}): Promise<string[]> {
  const { schema, config, apiKey, newAlbumName, justFiled } = params;
  const reevaluationCutoff = config.classificationThreshold + config.reevaluationMargin;

  const borderline = Object.values(schema.images)
    .filter(
      (img) =>
        img.filename !== justFiled &&
        img.label !== newAlbumName &&
        img.label !== UNCLASSIFIED_ALBUM &&
        img.confidence < reevaluationCutoff
    )
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, config.maxReevaluationsPerRun);

  const albums = Object.values(schema.albums).filter((a) => a.name !== UNCLASSIFIED_ALBUM);
  const moved: string[] = [];

  for (const img of borderline) {
    const result = await classifyImage({ imageUrl: img.url, albums, config, apiKey });
    const candidateName = slugifyAlbumName(result.label);

    const isBetterFit =
      result.decision === "existing" &&
      candidateName === newAlbumName &&
      result.confidence > img.confidence &&
      result.confidence >= config.classificationThreshold;

    if (isBetterFit) {
      img.label = candidateName;
      img.confidence = result.confidence;
      moved.push(img.filename);
    }
  }

  return moved;
}

/** Ensures the reserved Unclassified album exists; it's pinned so it's never auto-pruned. */
export function ensureUnclassifiedAlbum(schema: Schema): void {
  if (schema.albums[UNCLASSIFIED_ALBUM]) return;

  schema.albums[UNCLASSIFIED_ALBUM] = {
    name: UNCLASSIFIED_ALBUM,
    title: "Unclassified",
    description:
      "Images uploaded while AI classification was disconnected, waiting to be sorted once it's reconnected.",
    pinned: true,
    createdAt: new Date().toISOString(),
  };
}

/** Files an image into the Unclassified bucket without calling the AI provider. */
export function fileUnclassified(schema: Schema, imageUrl: string, filename: string): void {
  ensureUnclassifiedAlbum(schema);

  schema.images[filename] = {
    filename,
    url: imageUrl,
    label: UNCLASSIFIED_ALBUM,
    confidence: 0,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Drains a bounded batch of images out of the Unclassified bucket by classifying them for real,
 * now that a provider key is available. Called right after a key is connected, and again on
 * later uploads/admin requests until the backlog is empty, so a large backlog doesn't have to
 * fit inside a single request's time budget.
 */
export async function sweepUnclassified(params: {
  schema: Schema;
  config: AppConfig;
  apiKey: string;
  limit: number;
}): Promise<{ processed: number; remaining: number }> {
  const { schema, config, apiKey, limit } = params;

  const pending = Object.values(schema.images).filter((img) => img.label === UNCLASSIFIED_ALBUM);
  const batch = pending.slice(0, limit);

  for (const img of batch) {
    const albums = Object.values(schema.albums).filter((a) => a.name !== UNCLASSIFIED_ALBUM);
    const result = await classifyImage({ imageUrl: img.url, albums, config, apiKey });
    const { label } = resolveAlbumForResult(result, schema, config);

    img.label = label;
    img.confidence = result.confidence;
  }

  pruneEmptyAlbums(schema);

  return { processed: batch.length, remaining: pending.length - batch.length };
}

/** Albums are deleted once they hold no images, unless pinned (system album or user-created). */
export function pruneEmptyAlbums(schema: Schema): void {
  const occupied = new Set(Object.values(schema.images).map((img) => img.label));

  for (const name of Object.keys(schema.albums)) {
    if (name === UNCLASSIFIED_ALBUM) continue;

    const album = schema.albums[name];
    if (!album.pinned && !occupied.has(name)) {
      delete schema.albums[name];
    }
  }
}
