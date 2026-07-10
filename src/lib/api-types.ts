import type { Schema } from "./types";

export type SchemaResponse = Schema;

export interface UploadResponse {
  ok: true;
  filename: string;
  label: string;
  createdNewAlbum: boolean;
}

export interface CreateAlbumResponse {
  ok: true;
  name: string;
  moved: string[];
}

export interface ApiErrorResponse {
  error: string;
}
