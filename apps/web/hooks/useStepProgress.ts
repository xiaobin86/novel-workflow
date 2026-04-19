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

export interface StepProgress {
  events: ProgressEvent[];
  lastEvent: ProgressEvent | null;
  isComplete: boolean;
  error: string | null;
  percent: number;
}

export function useStepProgress(
  projectId: string,
  step: string,
  active: boolean
): StepProgress {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active || isComplete) return;

    const es = new EventSource(`/api/pipeline/${projectId}/${step}/events`);
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data) as ProgressEvent;
      setEvents((prev) => [...prev, data]);
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

  return { events, lastEvent, isComplete, error, percent };
}
