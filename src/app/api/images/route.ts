import { NextResponse } from "next/server";
import { readSchema } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const schema = await readSchema();
  return NextResponse.json(schema);
}
