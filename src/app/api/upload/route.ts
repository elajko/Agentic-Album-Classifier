import { NextRequest, NextResponse } from "next/server";
import { classifyAndFile } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { readSchema, storeImage, writeSchema } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  if (!(file instanceof File) || file.size === 0) {
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

    const { label, createdNewAlbum } = await classifyAndFile({
      schema,
      imageUrl: url,
      filename,
      config,
    });

    await writeSchema(schema);

    return NextResponse.json({ ok: true, filename, label, createdNewAlbum });
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
