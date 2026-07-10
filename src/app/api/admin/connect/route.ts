import { NextRequest, NextResponse } from "next/server";
import { sweepUnclassified } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { deleteStoredProviderKey, getActiveProviderKey, storeProviderKey, verifyAdminSecret } from "@/lib/secrets";
import { readSchema, writeSchema } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The Anthropic Admin API has no endpoint that hands back a usable secret key in exchange for a
 * user "logging in" - `GET /v1/organizations/api_keys/{id}` requires an org-admin OAuth token to
 * call it in the first place, and even then only returns a redacted `partial_key_hint`, never the
 * full secret. So this is a bring-your-own-key flow instead: the site owner pastes a key they
 * generated themselves at console.anthropic.com/settings/keys, gated by a password only they know.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const adminSecret = typeof body?.adminSecret === "string" ? body.adminSecret : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (!verifyAdminSecret(adminSecret)) {
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "An API key is required." }, { status: 400 });
  }

  const config = getConfig();

  try {
    await storeProviderKey(config.aiProvider, apiKey);

    // Immediately drain a first batch of the Unclassified backlog so reconnecting feels instant;
    // any remainder gets picked up by later uploads/admin sweeps.
    const schema = await readSchema();
    const { processed, remaining } = await sweepUnclassified({
      schema,
      config,
      apiKey,
      limit: config.maxSweepPerRun,
    });
    await writeSchema(schema);

    return NextResponse.json({ ok: true, processed, remaining });
  } catch (err) {
    console.error("Failed to connect provider key:", err);
    return NextResponse.json(
      { error: "Could not save the key. Check that Blob storage is configured for this project." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const adminSecret = typeof body?.adminSecret === "string" ? body.adminSecret : "";

  if (!verifyAdminSecret(adminSecret)) {
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
  }

  const config = getConfig();
  const active = await getActiveProviderKey(config.aiProvider);

  if (active?.source === "env") {
    return NextResponse.json(
      {
        error:
          "This key comes from an environment variable, not a saved key. Remove it from your " +
          "deployment's environment variables instead.",
      },
      { status: 409 }
    );
  }

  await deleteStoredProviderKey(config.aiProvider);
  return NextResponse.json({ ok: true });
}
