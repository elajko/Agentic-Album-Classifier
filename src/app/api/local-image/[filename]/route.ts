import { NextRequest, NextResponse } from "next/server";
import { inferMediaType } from "@/lib/media";
import { readImageBytes } from "@/lib/storage/local-backend";

export const runtime = "nodejs";

/** Serves images from local-storage/images to the browser - only ever hit in local storage mode (see lib/store.ts). */
export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  try {
    const bytes = await readImageBytes(`images/${params.filename}`);

    return new NextResponse(new Blob([new Uint8Array(bytes)]), {
      headers: {
        "Content-Type": inferMediaType(params.filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
