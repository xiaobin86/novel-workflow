import { NextRequest, NextResponse } from "next/server";
import { readState } from "@/lib/project-store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const state = await readState(id);
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}
