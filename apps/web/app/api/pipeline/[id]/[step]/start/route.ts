import { NextRequest, NextResponse } from "next/server";
import { SERVICE_URLS, StepName } from "@/lib/services";
import { readState, updateStep } from "@/lib/project-store";

// Default configs per step (server-side only, not user-configurable in v1.0)
const STEP_CONFIGS: Partial<Record<StepName, Record<string, unknown>>> = {
  image:    { width: 768, height: 768, num_inference_steps: 28, guidance_scale: 3.5 },
  video:    { width: 832, height: 480, num_frames: 65, num_inference_steps: 30 },
  assembly: { action_volume: 1.0, dialogue_volume: 1.0 },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  if (!SERVICE_URLS[stepName]) {
    return NextResponse.json({ error: `Unknown step: ${step}` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const userConfig = body.config ?? {};

  // Before starting video-service, unload image-service model (GPU handoff)
  if (stepName === "video") {
    try {
      await fetch(`${SERVICE_URLS.image}/model/unload`, { method: "POST" });
    } catch {
      // non-fatal; video service will still start
    }
  }

  // Build service request body
  let serviceBody: Record<string, unknown> = { project_id: projectId };

  if (stepName === "storyboard") {
    // Read input.txt and storyboard config from project dir
    const { readFile } = await import("fs/promises");
    const path = (await import("path")).default;
    const { PROJECTS_BASE_DIR } = await import("@/lib/services");
    const inputPath = path.join(PROJECTS_BASE_DIR, projectId, "input.txt");
    const text = await readFile(inputPath, "utf-8").catch(() => "");
    const state = await readState(projectId);
    serviceBody = {
      project_id: projectId,
      text,
      episode: state.episode,
      title: state.title,
    };
  } else {
    serviceBody.config = { ...(STEP_CONFIGS[stepName] ?? {}), ...userConfig };
  }

  const serviceRes = await fetch(`${SERVICE_URLS[stepName]}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serviceBody),
  });

  if (!serviceRes.ok) {
    const err = await serviceRes.text();
    return NextResponse.json({ error: err }, { status: serviceRes.status });
  }

  const { job_id } = await serviceRes.json();

  // Update project state
  await updateStep(projectId, stepName, { status: "in_progress", job_id });

  return NextResponse.json({ job_id, step: stepName }, { status: 202 });
}
