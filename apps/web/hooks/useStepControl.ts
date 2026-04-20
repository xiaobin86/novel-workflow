"use client";
import { useCallback, useState } from "react";
import { StepName } from "@/lib/services";

export function useStepControl(
  projectId: string,
  mutateState: () => Promise<void>
) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const setLoadingFor = (step: StepName, value: boolean) => {
    setLoading((prev) => ({ ...prev, [step]: value }));
  };

  const pauseStep = useCallback(
    async (step: StepName) => {
      setLoadingFor(step, true);
      try {
        const res = await fetch(
          `/api/pipeline/${projectId}/${step}/pause`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(await res.text());
        await mutateState();
      } finally {
        setLoadingFor(step, false);
      }
    },
    [projectId, mutateState]
  );

  const resumeStep = useCallback(
    async (step: StepName) => {
      setLoadingFor(step, true);
      try {
        const res = await fetch(
          `/api/pipeline/${projectId}/${step}/resume`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(await res.text());
        await mutateState();
      } finally {
        setLoadingFor(step, false);
      }
    },
    [projectId, mutateState]
  );

  const stopStep = useCallback(
    async (step: StepName) => {
      setLoadingFor(step, true);
      try {
        const res = await fetch(
          `/api/pipeline/${projectId}/${step}/stop`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(await res.text());
        await mutateState();
      } finally {
        setLoadingFor(step, false);
      }
    },
    [projectId, mutateState]
  );

  return { pauseStep, resumeStep, stopStep, loading };
}
