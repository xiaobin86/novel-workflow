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
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }

  await updateStep(projectId, stepName, { status: "in_progress" });
  return NextResponse.json({ status: "in_progress" });
}
