import { NextRequest, NextResponse } from "next/server";
import { classifyAndFile, fileUnclassified, ProviderAuthError } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { getActiveProviderKey } from "@/lib/secrets";
import { deleteImage, readSchema, writeSchema } from "@/lib/store";
import { UNCLASSIFIED_ALBUM } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIONS = ["file_unclassified", "retry_classification", "discard"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Resolves an upload that's already stored in Blob but wasn't added to the schema because
 * classification failed with a rejected (expired/revoked/invalid) provider key - see the
 * `key_expired` response from POST /api/upload. The client offers three choices; this is where
 * each one is actually carried out.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename : "";
  const url = typeof body?.url === "string" ? body.url : "";
  const action = body?.action as Action;

  if (!filename || !url || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (action === "discard") {
    await deleteImage(url).catch((err) => console.error("Failed to discard pending upload blob:", err));
    return NextResponse.json({ ok: true });
  }

  const config = getConfig();

  try {
    const schema = await readSchema();

    // Already resolved by an earlier request (e.g. a duplicate click) - just report current state.
    const existing = schema.images[filename];
    if (existing) {
      return NextResponse.json({
        ok: true,
        filename,
        label: existing.label,
        createdNewAlbum: false,
        classified: existing.label !== UNCLASSIFIED_ALBUM,
      });
    }

    if (action === "file_unclassified") {
      fileUnclassified(schema, url, filename);
      await writeSchema(schema);
      return NextResponse.json({
        ok: true,
        filename,
        label: UNCLASSIFIED_ALBUM,
        createdNewAlbum: false,
        classified: false,
      });
    }

    // action === "retry_classification"
    const active = await getActiveProviderKey(config.aiProvider);
    if (!active) {
      return NextResponse.json({ error: "No AI provider key is connected." }, { status: 409 });
    }

    try {
      const result = await classifyAndFile({ schema, imageUrl: url, filename, config, apiKey: active.key });
      await writeSchema(schema);
      return NextResponse.json({
        ok: true,
        filename,
        label: result.label,
        createdNewAlbum: result.createdNewAlbum,
        classified: true,
      });
    } catch (err) {
      if (err instanceof ProviderAuthError) {
        return NextResponse.json(
          {
            error: "key_expired",
            message: `Your ${err.provider === "openai" ? "OpenAI" : "Anthropic"} API key was rejected. It may have expired or been revoked.`,
            filename,
            url,
            provider: err.provider,
          },
          { status: 401 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("Resolving pending upload failed:", err);
    return NextResponse.json({ error: "Could not resolve the pending upload." }, { status: 502 });
  }
}
