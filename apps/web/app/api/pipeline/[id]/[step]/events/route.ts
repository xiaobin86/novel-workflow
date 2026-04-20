import { NextRequest } from "next/server";
import { SERVICE_URLS, StepName } from "@/lib/services";
import { readState, updateStep } from "@/lib/project-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; step: string }> }
) {
  const { id: projectId, step } = await params;
  const stepName = step as StepName;

  let state;
  try {
    state = await readState(projectId);
  } catch {
    return new Response("Project not found", { status: 404 });
  }

  const jobId = state.steps[stepName]?.job_id;
  if (!jobId) {
    return new Response("No active job for this step", { status: 404 });
  }

  const serviceUrl = SERVICE_URLS[stepName];
  const upstream = await fetch(`${serviceUrl}/jobs/${jobId}/events`);
  if (!upstream.ok || !upstream.body) {
    return new Response("Failed to connect to upstream service", { status: 502 });
  }

  const encoder = new TextEncoder();
  let done = false;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let event = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));

              // Update state.json on terminal events
              if (event === "complete") {
                const parsed = JSON.parse(data);
                await updateStep(projectId, stepName, {
                  status: "completed",
                  result: parsed.result ?? null,
                });
                done = true;
              } else if (event === "stopped") {
                await updateStep(projectId, stepName, { status: "stopped" });
                done = true;
              } else if (event === "error") {
                const parsed = JSON.parse(data);
                if (!parsed.retryable) {
                  await updateStep(projectId, stepName, {
                    status: "failed",
                    result: null,
                  });
                  done = true;
                }
              }
            }
          }
        }
      } finally {
        controller.close();
        reader.cancel();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
