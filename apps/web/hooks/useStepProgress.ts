"use client";
import { useEffect, useRef, useState } from "react";

export interface ProgressEvent {
  shot_id?: string;
  done?: number;
  total?: number;
  message?: string;
  skipped?: boolean;
  phase?: string;
  track?: string;
  filename?: string;
}

export interface ProgressArtifact {
  shot_id?: string;
  type: "image" | "audio" | "video" | "text";
  filename?: string;
  track?: string;
  skipped?: boolean;
}

export interface StepProgress {
  events: ProgressEvent[];
  lastEvent: ProgressEvent | null;
  isComplete: boolean;
  isPaused: boolean;
  isStopped: boolean;
  error: string | null;
  percent: number;
  artifacts: ProgressArtifact[];
}

export function useStepProgress(
  projectId: string,
  step: string,
  active: boolean
): StepProgress {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ProgressArtifact[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active || isComplete) return;

    queueMicrotask(() => setArtifacts([]));

    const es = new EventSource(`/api/pipeline/${projectId}/${step}/events`);
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data) as ProgressEvent;
      setEvents((prev) => [...prev, data]);

      if (data.shot_id) {
        const artifactType: ProgressArtifact["type"] =
          step === "storyboard"
            ? "text"
            : step === "image"
            ? "image"
            : step === "tts"
            ? "audio"
            : step === "video"
            ? "video"
            : "text";
        setArtifacts((prev) => [
          ...prev,
          {
            shot_id: data.shot_id,
            type: artifactType,
            filename: data.filename,
          },
        ]);
      }
    });

    es.addEventListener("paused", () => {
      setIsPaused(true);
    });

    es.addEventListener("resumed", () => {
      setIsPaused(false);
    });

    es.addEventListener("stopped", () => {
      setIsStopped(true);
      setIsComplete(true);
      es.close();
    });

    es.addEventListener("complete", () => {
      setIsComplete(true);
      es.close();
    });

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (!data.retryable) setError(data.message ?? "Unknown error");
      } catch {
        // network error / connection close
      }
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [projectId, step, active, isComplete]);

  const lastEvent = events[events.length - 1] ?? null;
  const percent =
    lastEvent?.total
      ? Math.round(((lastEvent.done ?? 0) / lastEvent.total) * 100)
      : 0;

  return { events, lastEvent, isComplete, isPaused, isStopped, error, percent, artifacts };
}
