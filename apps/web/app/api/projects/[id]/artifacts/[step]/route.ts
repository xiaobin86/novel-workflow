import { NextRequest, NextResponse } from "next/server";
import { StepName } from "@/lib/services";
import { recoverStepResult } from "@/lib/project-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  const result = await recoverStepResult(projectId, stepName);
  const res = result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "No artifacts found" }, { status: 404 });

  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
