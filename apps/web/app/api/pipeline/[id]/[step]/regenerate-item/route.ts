import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR, StepName } from "@/lib/services";
import { readState } from "@/lib/project-store";

/** Delete artifact files that belong to a specific shot for the given step. */
async function deleteItemFiles(projectDir: string, stepName: StepName, shot_id: string) {
  const subdirs: Record<string, string> = {
    image: "images",
    tts:   "audio",
    video: "clips",
  };
  const subdir = subdirs[stepName];
  if (!subdir) return;

  const dir = path.join(projectDir, subdir);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    files
      .filter((f) => f.startsWith(shot_id))
      .map((f) => fs.rm(path.join(dir, f), { force: true }))
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  if (!["image", "tts", "video"].includes(stepName)) {
    return NextResponse.json(
      { error: "产物级重新生成仅支持 image / tts / video 步骤" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { shot_id } = body as { shot_id?: string };
  if (!shot_id) {
    return NextResponse.json({ error: "shot_id is required" }, { status: 400 });
  }

  // Validate project exists
  let state;
  try {
    state = await readState(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Guard: cannot run while step is active
  const s = state.steps[stepName]?.status;
  if (s === "in_progress" || s === "paused") {
    return NextResponse.json(
      { error: `步骤「${stepName}」正在执行中` },
      { status: 409 }
    );
  }

  // Validate shot_id exists in storyboard
  const projectDir = path.join(PROJECTS_BASE_DIR, projectId);
  try {
    const sb = JSON.parse(
      await fs.readFile(path.join(projectDir, "storyboard.json"), "utf-8")
    );
    const exists = (sb.shots as Array<{ shot_id: string }> | undefined)
      ?.some((s) => s.shot_id === shot_id);
    if (!exists) {
      return NextResponse.json({ error: `Shot "${shot_id}" not found in storyboard` }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  }

  // Delete the artifact files for this shot
  try {
    await deleteItemFiles(projectDir, stepName, shot_id);
  } catch (err) {
    console.error(`Failed to delete item files for ${shot_id}:`, err);
    return NextResponse.json({ error: "删除产物文件失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, shot_id });
}
