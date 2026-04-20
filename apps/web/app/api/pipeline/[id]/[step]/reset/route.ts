import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PROJECTS_BASE_DIR, StepName } from "@/lib/services";
import { readState, updateStep } from "@/lib/project-store";

/** Artifact paths (files or directories) to wipe for each step */
const STEP_ARTIFACTS: Record<StepName, string[]> = {
  storyboard: ["storyboard.json"],
  image:      ["images"],
  tts:        ["audio"],
  video:      ["clips"],
  assembly:   ["output"],
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  // Validate project exists
  let state;
  try {
    state = await readState(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Guard: cannot reset a running step
  const s = state.steps[stepName]?.status;
  if (s === "in_progress" || s === "paused") {
    return NextResponse.json(
      { error: `步骤「${stepName}」正在执行中，请先停止后再重新生成` },
      { status: 409 }
    );
  }

  // Delete all artifacts for this step
  const projectDir = path.join(PROJECTS_BASE_DIR, projectId);
  for (const artifact of (STEP_ARTIFACTS[stepName] ?? [])) {
    const artifactPath = path.join(projectDir, artifact);
    try {
      const stat = await fs.stat(artifactPath);
      if (stat.isDirectory()) {
        // Clear contents but keep the directory (service may expect it to exist)
        const files = await fs.readdir(artifactPath);
        await Promise.all(
          files.map((f) => fs.rm(path.join(artifactPath, f), { recursive: true, force: true }))
        );
      } else {
        await fs.rm(artifactPath, { force: true });
      }
    } catch {
      // Doesn't exist — that's fine
    }
  }

  // Reset step state
  await updateStep(projectId, stepName, {
    status: "pending",
    job_id: null,
    result: null,
  });

  return NextResponse.json({ ok: true });
}
