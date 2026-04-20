import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR } from "@/lib/services";
import { readState } from "@/lib/project-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectDir = path.join(PROJECTS_BASE_DIR, id);

  // 1. Check project exists and read state
  let state;
  try {
    state = await readState(id);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 2. Reject if any step is actively running
  const activeStep = Object.entries(state.steps).find(([, s]) =>
    s.status === "in_progress" || s.status === "paused"
  );
  if (activeStep) {
    return NextResponse.json(
      { error: `步骤「${activeStep[0]}」正在执行中，请先停止后再删除` },
      { status: 409 }
    );
  }

  // 3. Delete entire project directory
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to delete project ${id}:`, err);
    return NextResponse.json({ error: "删除失败，请重试" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
