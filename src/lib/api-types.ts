import type { AiProvider } from "./config";
import type { Schema } from "./types";

export type SchemaResponse = Schema;

export interface UploadResponse {
  ok: true;
  filename: string;
  label: string;
  createdNewAlbum: boolean;
  classified: boolean;
}

export interface CreateAlbumResponse {
  ok: true;
  name: string;
  moved: string[];
}

export interface StatusResponse {
  enabled: boolean;
  source: "env" | "stored" | null;
  provider: AiProvider;
  unclassifiedCount: number;
}

export interface SweepResponse {
  ok: true;
  processed: number;
  remaining: number;
}

export interface ApiErrorResponse {
  error: string;
}
