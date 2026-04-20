"use client";
import { useCallback, useState } from "react";
import { StepName } from "@/lib/services";

export function useStepControl(
  projectId: string,
  mutateState: () => Promise<void>
) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setLoadingFor = (step: StepName, value: boolean) =>
    setLoading((prev) => ({ ...prev, [step]: value }));

  const setErrorFor = (step: StepName, msg: string) =>
    setErrors((prev) => ({ ...prev, [step]: msg }));

  const clearError = (step: StepName) =>
    setErrors((prev) => { const n = { ...prev }; delete n[step]; return n; });

  async function callControl(step: StepName, action: "pause" | "resume" | "stop") {
    setLoadingFor(step, true);
    clearError(step);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/${step}/${action}`, { method: "POST" });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          // body.error may itself be a JSON string (e.g. FastAPI {"detail":"Not Found"})
          const raw = body.error ?? msg;
          try {
            const inner = JSON.parse(raw);
            msg = inner.detail ?? inner.message ?? raw;
          } catch {
            msg = raw;
          }
        } catch { /* ignore */ }
        setErrorFor(step, msg);
        await mutateState(); // refresh state even on error (e.g. status changed to stopped)
        return;
      }
      await mutateState();
    } catch (e) {
      setErrorFor(step, e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoadingFor(step, false);
    }
  }

  const pauseStep  = useCallback((step: StepName) => callControl(step, "pause"),  [projectId, mutateState]);
  const resumeStep = useCallback((step: StepName) => callControl(step, "resume"), [projectId, mutateState]);
  const stopStep   = useCallback((step: StepName) => callControl(step, "stop"),   [projectId, mutateState]);

  return { pauseStep, resumeStep, stopStep, loading, errors };
}
