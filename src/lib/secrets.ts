import { del, get, put } from "@vercel/blob";
import type { AiProvider } from "./config";
import { decryptSecret, encryptSecret, timingSafeEqualStrings } from "./crypto";

function secretPathname(provider: AiProvider): string {
  return `secrets/${provider}.key.enc`;
}

function requireAdminSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error(
      "ADMIN_SECRET is not configured on the server; set it before connecting a provider key."
    );
  }
  return secret;
}

export function verifyAdminSecret(candidate: string): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !candidate) return false;
  return timingSafeEqualStrings(candidate, expected);
}

/** Encrypts and stores an API key for `provider` in a private Blob, keyed off ADMIN_SECRET. */
export async function storeProviderKey(provider: AiProvider, apiKey: string): Promise<void> {
  const encrypted = encryptSecret(apiKey, requireAdminSecret());

  await put(secretPathname(provider), encrypted, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
  });
}

async function readStoredProviderKey(provider: AiProvider): Promise<string | null> {
  try {
    const result = await get(secretPathname(provider), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;

    const payload = await new Response(result.stream).text();
    return decryptSecret(payload, requireAdminSecret());
  } catch (err) {
    console.error(`Failed to read stored ${provider} key:`, err);
    return null;
  }
}

export async function deleteStoredProviderKey(provider: AiProvider): Promise<void> {
  await del(secretPathname(provider)).catch(() => undefined);
}

export interface ActiveProviderKey {
  key: string;
  source: "env" | "stored";
}

/**
 * Resolves the key actually used for classification: an env var set at deploy time takes
 * priority (matches the original deploy-only configuration), falling back to a key connected
 * at runtime through the admin "Connect" flow.
 */
export async function getActiveProviderKey(provider: AiProvider): Promise<ActiveProviderKey | null> {
  const envKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (envKey) return { key: envKey, source: "env" };

  const stored = await readStoredProviderKey(provider);
  if (stored) return { key: stored, source: "stored" };

  return null;
}
