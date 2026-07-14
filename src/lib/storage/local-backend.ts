import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptySchema, type Schema } from "../types";

/**
 * Local-disk fallback used for development when BLOB_READ_WRITE_TOKEN isn't set, so you can run
 * the app without provisioning a Vercel Blob store first. Never used in production - see
 * ../store.ts for how the backend is selected, and blob-backend.ts for the real deployment path.
 */
const ROOT = path.join(process.cwd(), "local-storage");
const IMAGES_DIR = path.join(ROOT, "images");
const SCHEMA_PATH = path.join(ROOT, "schema.json");

async function ensureDirs(): Promise<void> {
  await mkdir(IMAGES_DIR, { recursive: true });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Strips any directory components, so a filename built from user/URL input can't escape IMAGES_DIR. */
function safeImagePath(filename: string): string {
  return path.join(IMAGES_DIR, path.basename(filename));
}

export async function readSchema(): Promise<Schema> {
  try {
    const text = await readFile(SCHEMA_PATH, "utf8");
    return JSON.parse(text) as Schema;
  } catch {
    return createEmptySchema();
  }
}

export async function writeSchema(schema: Schema): Promise<void> {
  await ensureDirs();
  await writeFile(SCHEMA_PATH, JSON.stringify(schema, null, 2));
}

export async function storeImage(file: File): Promise<{ url: string; pathname: string }> {
  await ensureDirs();

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);

  let filename = safeName;
  let suffix = 2;
  while (await pathExists(safeImagePath(filename))) {
    filename = `${base}-${suffix}${ext}`;
    suffix += 1;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(safeImagePath(filename), bytes);

  return { url: `/api/local-image/${encodeURIComponent(filename)}`, pathname: `images/${filename}` };
}

export async function deleteImage(url: string): Promise<void> {
  const filename = decodeURIComponent(url.split("/").pop() ?? "");
  if (!filename) return;
  await rm(safeImagePath(filename), { force: true });
}

/** Reads raw image bytes straight off disk - used to inline images into AI calls, since a
 * localhost URL isn't reachable from the provider's servers the way a public Blob URL is. */
export async function readImageBytes(pathname: string): Promise<Buffer> {
  const filename = pathname.replace(/^images\//, "");
  return readFile(safeImagePath(filename));
}

export async function getImageSize(pathname: string): Promise<number> {
  const filename = pathname.replace(/^images\//, "");
  const stats = await stat(safeImagePath(filename));
  return stats.size;
}
