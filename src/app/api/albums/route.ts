import { NextRequest, NextResponse } from "next/server";
import { pruneEmptyAlbums, reevaluateBorderlineImages } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { readSchema, writeSchema } from "@/lib/store";
import { slugifyAlbumName } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function uniqueName(title: string, existing: Record<string, unknown>): string {
  const base = slugifyAlbumName(title);
  let name = base;
  let suffix = 2;

  while (existing[name]) {
    name = `${base}-${suffix}`;
    suffix += 1;
  }

  return name;
}

/**
 * Lets a user optionally provide their own album ahead of time (README feature).
 * User-created albums are pinned, so they survive even before any image is filed
 * into them. Existing borderline images are agentically reevaluated against the
 * new album in case it's a better fit than where they currently sit.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!title || !description) {
    return NextResponse.json(
      { error: "Both `title` and `description` are required." },
      { status: 400 }
    );
  }

  try {
    const schema = await readSchema();
    const name = uniqueName(title, schema.albums);

    schema.albums[name] = {
      name,
      title,
      description,
      pinned: true,
      createdAt: new Date().toISOString(),
    };

    const config = getConfig();
    const moved = await reevaluateBorderlineImages({ schema, config, newAlbumName: name });
    pruneEmptyAlbums(schema);
    await writeSchema(schema);

    return NextResponse.json({ ok: true, name, moved });
  } catch (err) {
    console.error("Album creation failed:", err);
    return NextResponse.json(
      { error: "Could not create the album. Check your Blob and AI provider configuration." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");

  if (!name) {
    return NextResponse.json({ error: "Missing `name` query parameter." }, { status: 400 });
  }

  const schema = await readSchema();
  const album = schema.albums[name];

  if (!album) {
    return NextResponse.json({ error: "Album not found." }, { status: 404 });
  }

  const hasImages = Object.values(schema.images).some((img) => img.label === name);

  if (hasImages) {
    return NextResponse.json(
      { error: "This album still has images in it; move or delete them first." },
      { status: 409 }
    );
  }

  delete schema.albums[name];
  await writeSchema(schema);

  return NextResponse.json({ ok: true });
}
