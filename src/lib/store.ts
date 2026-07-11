import { inferMediaType } from "./media";
import * as blobBackend from "./storage/blob-backend";
import * as localBackend from "./storage/local-backend";
import type { Schema } from "./types";

/**
 * Picks the storage backend automatically: a real Blob store when BLOB_READ_WRITE_TOKEN is
 * configured (production, or local dev pointed at a real store), otherwise local disk under
 * ./local-storage so the app runs with zero setup. Every route imports from this file rather than
 * either backend directly, so the choice is invisible outside this module.
 */
function isLocalMode(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN;
}

export async function readSchema(): Promise<Schema> {
  return isLocalMode() ? localBackend.readSchema() : blobBackend.readSchema();
}

export async function writeSchema(schema: Schema): Promise<void> {
  return isLocalMode() ? localBackend.writeSchema(schema) : blobBackend.writeSchema(schema);
}

export async function storeImage(file: File): Promise<{ url: string; pathname: string }> {
  return isLocalMode() ? localBackend.storeImage(file) : blobBackend.storeImage(file);
}

export async function deleteImage(url: string): Promise<void> {
  return isLocalMode() ? localBackend.deleteImage(url) : blobBackend.deleteImage(url);
}

/**
 * Raw bytes for an image regardless of which backend stored it - used by classify.ts, which
 * downscales every image before sending it to the AI provider (see lib/image.ts) and so needs
 * actual pixel data either way, not just a URL. For a locally-stored image that's a plain disk
 * read; for a Blob-backed image, it means fetching the public URL ourselves rather than letting
 * the provider fetch it directly, which is the one bit of efficiency traded away for downscaling.
 */
export async function getImageBytes(params: { filename: string; url: string }): Promise<{
  data: Buffer;
  mediaType: string;
}> {
  if (isLocalMode()) {
    const data = await localBackend.readImageBytes(`images/${params.filename}`);
    return { data, mediaType: inferMediaType(params.filename) };
  }

  const res = await fetch(params.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image from Blob storage (${res.status}): ${params.url}`);
  }

  const mediaType = res.headers.get("content-type") || inferMediaType(params.url);
  const data = Buffer.from(await res.arrayBuffer());
  return { data, mediaType };
}
