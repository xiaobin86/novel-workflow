import { NextRequest, NextResponse } from "next/server";
import { SERVICE_URLS } from "@/lib/services";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params; // consume params
  try {
    await fetch(`${SERVICE_URLS.image}/model/unload`, { method: "POST" });
  } catch {
    // best-effort
  }
  return new NextResponse(null, { status: 204 });
}
