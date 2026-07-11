import { put, get, del } from "@vercel/blob";
import { createEmptySchema, type Schema } from "../types";

const SCHEMA_PATHNAME = "schema.json";
const IMAGE_PREFIX = "images/";

/**
 * Vercel serverless functions have no writable persistent disk, so schema.json and the uploaded
 * images both live in Vercel Blob storage. Used whenever BLOB_READ_WRITE_TOKEN is configured -
 * see ../store.ts for the local-disk alternative used otherwise.
 */
export async function readSchema(): Promise<Schema> {
  try {
    const result = await get(SCHEMA_PATHNAME, { access: "public", useCache: false });

    if (!result || result.statusCode !== 200) return createEmptySchema();

    const text = await new Response(result.stream).text();
    return JSON.parse(text) as Schema;
  } catch (err) {
    console.error("Failed to read schema.json from blob storage, starting fresh:", err);
    return createEmptySchema();
  }
}

export async function writeSchema(schema: Schema): Promise<void> {
  await put(SCHEMA_PATHNAME, JSON.stringify(schema, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

export async function storeImage(
  file: File
): Promise<{ url: string; pathname: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  const blob = await put(`${IMAGE_PREFIX}${safeName}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type || "application/octet-stream",
  });

  return { url: blob.url, pathname: blob.pathname };
}

export async function deleteImage(url: string): Promise<void> {
  await del(url);
}
