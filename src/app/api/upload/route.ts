import { NextRequest, NextResponse } from "next/server";
import { classifyAndFile, fileUnclassified, ProviderAuthError, sweepUnclassified } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { getActiveProviderKey } from "@/lib/secrets";
import { readSchema, storeImage, writeSchema } from "@/lib/store";
import { UNCLASSIFIED_ALBUM } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Small opportunistic drain of the Unclassified backlog on every classified upload, so it empties out gradually. */
const OPPORTUNISTIC_SWEEP_LIMIT = 3;

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with an `image` field." },
      { status: 400 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("image");

  // A FormData entry is either a string or a File - never check `instanceof File` here, since the
  // File global isn't available in every Node runtime; narrowing out `string`/`null` is enough and
  // works everywhere.
  if (!file || typeof file === "string" || file.size === 0) {
    return NextResponse.json({ error: "No image file was provided." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "The uploaded file is not an image." }, { status: 400 });
  }

  const config = getConfig();

  try {
    const schema = await readSchema();
    const { url, pathname } = await storeImage(file);
    const filename = pathname.replace(/^images\//, "");

    const active = await getActiveProviderKey(config.aiProvider);

    if (!active) {
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

    // The image is already stored in Blob at this point, but not yet added to the schema - if
    // classification fails because the key itself is bad, it stays that way (unregistered, not
    // shown anywhere) until the client tells us how to resolve it via /api/upload/resolve.
    try {
      const result = await classifyAndFile({ schema, imageUrl: url, filename, config, apiKey: active.key });
      await writeSchema(schema);

      try {
        await sweepUnclassified({ schema, config, apiKey: active.key, limit: OPPORTUNISTIC_SWEEP_LIMIT });
        await writeSchema(schema);
      } catch (sweepErr) {
        // Best-effort backlog drain - don't fail an otherwise-successful upload over it.
        console.error("Opportunistic Unclassified sweep failed:", sweepErr);
      }

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
    console.error("Upload/classification failed:", err);
    return NextResponse.json(
      {
        error:
          "Upload or classification failed. Check that BLOB_READ_WRITE_TOKEN is set and that your " +
          `AI provider API key is configured (AI_PROVIDER=${config.aiProvider}).`,
      },
      { status: 502 }
    );
  }
}
