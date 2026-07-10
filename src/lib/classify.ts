import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AppConfig } from "./config";
import type { Album, ImageRecord, Schema } from "./types";
import { slugifyAlbumName } from "./types";

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

function getModel(config: AppConfig): LanguageModel {
  return config.aiProvider === "openai"
    ? openai(config.openaiModel)
    : anthropic(config.anthropicModel);
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
}): Promise<ClassificationResult> {
  const { imageUrl, albums, config } = params;

  const { object } = await generateObject({
    model: getModel(config),
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
 * Runs the full agentic filing step for one newly-uploaded image: classify it, mint a new
 * album if nothing fits well (README's "agentic album creation" feature), file the image,
 * and then reevaluate other borderline images in case the new album is a better home for them
 * (README's "agentic image reevaluation" feature). Mutates and returns the schema.
 */
export async function classifyAndFile(params: {
  schema: Schema;
  imageUrl: string;
  filename: string;
  config: AppConfig;
}): Promise<{ schema: Schema; label: string; createdNewAlbum: boolean }> {
  const { schema, imageUrl, filename, config } = params;
  const albums = Object.values(schema.albums);

  const result = await classifyImage({ imageUrl, albums, config });

  let createdNewAlbum = false;
  let label = result.label;

  const fitsExisting =
    result.decision === "existing" &&
    schema.albums[slugifyAlbumName(result.label)] !== undefined &&
    result.confidence >= config.classificationThreshold;

  if (fitsExisting) {
    label = slugifyAlbumName(result.label);
  } else {
    // Nothing fit well enough (either the model said so, or its confidence fell below
    // the threshold) - agentically mint a new album for this image.
    const { name, title } = uniqueAlbumName(result.label, schema.albums);

    schema.albums[name] = {
      name,
      title,
      description: result.description,
      pinned: false,
      createdAt: new Date().toISOString(),
    };

    label = name;
    createdNewAlbum = true;
  }

  const record: ImageRecord = {
    filename,
    url: imageUrl,
    label,
    confidence: result.confidence,
    uploadedAt: new Date().toISOString(),
  };

  schema.images[filename] = record;

  if (createdNewAlbum) {
    await reevaluateBorderlineImages({ schema, config, newAlbumName: label, justFiled: filename });
  }

  pruneEmptyAlbums(schema);

  return { schema, label, createdNewAlbum };
}

/**
 * Agentic reevaluation: whenever a new album appears, images that were previously filed with
 * low confidence might actually belong there instead. Re-classifies a bounded set of the most
 * borderline existing images against the updated album set and moves them if the new album is a
 * strictly better fit.
 */
export async function reevaluateBorderlineImages(params: {
  schema: Schema;
  config: AppConfig;
  newAlbumName: string;
  justFiled?: string;
}): Promise<string[]> {
  const { schema, config, newAlbumName, justFiled } = params;
  const reevaluationCutoff = config.classificationThreshold + config.reevaluationMargin;

  const borderline = Object.values(schema.images)
    .filter(
      (img) =>
        img.filename !== justFiled &&
        img.label !== newAlbumName &&
        img.confidence < reevaluationCutoff
    )
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, config.maxReevaluationsPerRun);

  const albums = Object.values(schema.albums);
  const moved: string[] = [];

  for (const img of borderline) {
    const result = await classifyImage({ imageUrl: img.url, albums, config });
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

/** Albums are deleted once they hold no images, unless the user pinned them (README feature). */
export function pruneEmptyAlbums(schema: Schema): void {
  const occupied = new Set(Object.values(schema.images).map((img) => img.label));

  for (const name of Object.keys(schema.albums)) {
    const album = schema.albums[name];
    if (!album.pinned && !occupied.has(name)) {
      delete schema.albums[name];
    }
  }
}
