/** Reserved album that catches uploads made while no AI provider key is connected. */
export const UNCLASSIFIED_ALBUM = "unclassified";

export interface Album {
  /** Slug used as the stable key (lowercase, hyphenated). */
  name: string;
  /** Human-friendly title shown in the UI. */
  title: string;
  /** Short description used as a classification anchor for future images. */
  description: string;
  /** True if the album was explicitly created by the user; pinned albums survive even when empty. */
  pinned: boolean;
  createdAt: string;
}

export interface ImageRecord {
  filename: string;
  url: string;
  label: string;
  confidence: number;
  uploadedAt: string;
  /** Bytes. Optional since records written before this field existed won't have it. */
  size?: number;
}

export interface Schema {
  images: Record<string, ImageRecord>;
  albums: Record<string, Album>;
}

export function createEmptySchema(): Schema {
  return { images: {}, albums: {} };
}

export function slugifyAlbumName(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}
