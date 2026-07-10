import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getActiveProviderKey } from "@/lib/secrets";
import { readSchema } from "@/lib/store";
import { UNCLASSIFIED_ALBUM } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public status: whether classification is enabled and how big the Unclassified backlog is. Never exposes the key itself. */
export async function GET() {
  const config = getConfig();
  const [active, schema] = await Promise.all([getActiveProviderKey(config.aiProvider), readSchema()]);

  const unclassifiedCount = Object.values(schema.images).filter(
    (img) => img.label === UNCLASSIFIED_ALBUM
  ).length;

  return NextResponse.json({
    enabled: active !== null,
    source: active?.source ?? null,
    provider: config.aiProvider,
    unclassifiedCount,
  });
}
