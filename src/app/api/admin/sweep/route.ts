import { NextRequest, NextResponse } from "next/server";
import { sweepUnclassified } from "@/lib/classify";
import { getConfig } from "@/lib/config";
import { getActiveProviderKey, verifyAdminSecret } from "@/lib/secrets";
import { readSchema, writeSchema } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Manually drains another batch of the Unclassified backlog. Gated since each image costs an LLM call. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const adminSecret = typeof body?.adminSecret === "string" ? body.adminSecret : "";

  if (!verifyAdminSecret(adminSecret)) {
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
  }

  const config = getConfig();
  const active = await getActiveProviderKey(config.aiProvider);

  if (!active) {
    return NextResponse.json({ error: "No AI provider key is connected." }, { status: 409 });
  }

  try {
    const schema = await readSchema();
    const { processed, remaining } = await sweepUnclassified({
      schema,
      config,
      apiKey: active.key,
      limit: config.maxSweepPerRun,
    });
    await writeSchema(schema);

    return NextResponse.json({ ok: true, processed, remaining });
  } catch (err) {
    console.error("Sweep failed:", err);
    return NextResponse.json({ error: "Sweep failed." }, { status: 502 });
  }
}
