import { NextRequest, NextResponse } from "next/server";
import { SERVICE_URLS, StepName } from "@/lib/services";
import { readState, updateStep } from "@/lib/project-store";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  const state = await readState(projectId);
  const jobId = state.steps[stepName]?.job_id;
  if (!jobId) {
    return NextResponse.json({ error: "No active job" }, { status: 404 });
  }

  const serviceUrl = SERVICE_URLS[stepName];
  const res = await fetch(`${serviceUrl}/jobs/${jobId}/resume`, {
    method: "POST",
  });

  if (!res.ok) {
    // Job no longer exists in service (e.g. service restarted) — mark as stopped
    // so the user can restart rather than being stuck in a broken paused state.
    if (res.status === 404) {
      await updateStep(projectId, stepName, { status: "stopped", job_id: null });
      return NextResponse.json(
        { error: "任务已失效（服务可能已重启），请点击「重新开始」重新执行" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }

  await updateStep(projectId, stepName, { status: "in_progress" });
  return NextResponse.json({ status: "in_progress" });
}
