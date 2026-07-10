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

/**
 * Returned instead of UploadResponse/ApiErrorResponse when the provider rejected the API key
 * (expired/revoked/invalid). The image is already stored but not yet filed anywhere - resolve it
 * with a follow-up call to POST /api/upload/resolve using one of the three actions.
 */
export interface KeyExpiredResponse {
  error: "key_expired";
  message: string;
  filename: string;
  url: string;
  provider: AiProvider;
}

export type ResolveAction = "file_unclassified" | "retry_classification" | "discard";

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

export interface ConnectResponse {
  ok: true;
  processed: number;
  remaining: number;
  keyRejected: boolean;
}

export interface ApiErrorResponse {
  error: string;
}
