"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProjectState } from "@/hooks/useProjectState";
import { useStepProgress } from "@/hooks/useStepProgress";
import { STEP_ORDER, STEP_LABELS, StepName } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

// ── Auto-mode hook ─────────────────────────────────────────────────────────────
function useAutoMode(projectId: string) {
  const key = `auto-mode-${projectId}`;
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(localStorage.getItem(key) === "true");
  }, [key]);
  const toggle = () => setEnabled((prev) => {
    const next = !prev;
    localStorage.setItem(key, String(next));
    return next;
  });
  return [enabled, toggle] as const;
}

// ── Status helpers ─────────────────────────────────────────────────────────────
const STATUS_ICONS: Record<string, string> = {
  pending:     "○",
  in_progress: "◌",
  completed:   "✓",
  failed:      "✗",
};
const STATUS_COLORS: Record<string, string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-500",
  completed:   "text-green-600",
  failed:      "text-red-500",
};

// ── Step content ───────────────────────────────────────────────────────────────
function StepContent({
  step,
  projectId,
  status,
  isActive,
}: {
  step: StepName;
  projectId: string;
  status: string;
  isActive: boolean;
}) {
  const progress = useStepProgress(projectId, step, isActive && status === "in_progress");

  if (status === "pending") {
    return <p className="text-sm text-zinc-400">等待执行</p>;
  }

  if (status === "in_progress") {
    return (
      <div className="space-y-2">
        <Progress value={progress.percent} className="h-2" />
        <p className="text-sm text-zinc-600">
          {progress.lastEvent?.message ?? progress.lastEvent?.phase ?? "处理中..."}
          {progress.lastEvent?.done !== undefined && progress.lastEvent?.total
            ? ` (${progress.lastEvent.done}/${progress.lastEvent.total})`
            : ""}
        </p>
        {progress.error && (
          <p className="text-sm text-red-500">{progress.error}</p>
        )}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="space-y-2">
        {step === "storyboard" && (
          <p className="text-sm text-green-700">
            分镜已生成 — <a href={`/api/projects/${projectId}/files/storyboard.json?download=1`} className="underline">下载 JSON</a>
          </p>
        )}
        {step === "image" && (
          <p className="text-sm text-green-700">图片已生成，可在下方预览</p>
        )}
        {step === "tts" && (
          <p className="text-sm text-green-700">音频已生成</p>
        )}
        {step === "video" && (
          <p className="text-sm text-green-700">视频片段已生成</p>
        )}
        {step === "assembly" && (
          <div className="space-y-1">
            <p className="text-sm text-green-700">最终视频已生成</p>
            <div className="flex gap-2 mt-2">
              <a href={`/api/projects/${projectId}/files/output/final.mp4?download=1`}>
                <Button size="sm" variant="outline">下载 MP4</Button>
              </a>
              <a href={`/api/projects/${projectId}/files/output/final.srt?download=1`}>
                <Button size="sm" variant="outline">下载 SRT</Button>
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status === "failed") {
    return <p className="text-sm text-red-500">执行失败，请重试</p>;
  }

  return null;
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { state, mutate } = useProjectState(projectId);
  const [autoMode, toggleAutoMode] = useAutoMode(projectId);
  const [starting, setStarting] = useState<StepName | null>(null);
  const autoRef = useRef(autoMode);
  autoRef.current = autoMode;

  // Auto-advance: when a step completes, start the next one
  useEffect(() => {
    if (!state || !autoRef.current) return;
    const steps = state.steps as Record<StepName, { status: string }>;

    // Find the next pending step after all completed/in_progress
    for (let i = 0; i < STEP_ORDER.length - 1; i++) {
      const cur = STEP_ORDER[i];
      const next = STEP_ORDER[i + 1];
      if (steps[cur]?.status === "completed" && steps[next]?.status === "pending") {
        // image needs tts to be done first before video can start
        if (next === "video") {
          if (steps.image?.status !== "completed" || steps.tts?.status !== "completed") continue;
        }
        startStep(next);
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function startStep(step: StepName) {
    setStarting(step);
    try {
      await fetch(`/api/pipeline/${projectId}/${step}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await mutate();
    } finally {
      setStarting(null);
    }
  }

  if (!state) {
    return <div className="p-8 text-zinc-400">加载中...</div>;
  }

  const steps = state.steps as Record<StepName, { status: string; job_id: string | null }>;

  function canStart(step: StepName): boolean {
    const s = steps[step]?.status;
    if (s !== "pending" && s !== "failed") return false;
    const idx = STEP_ORDER.indexOf(step);
    if (idx === 0) return true;
    // image and tts can both start after storyboard
    if (step === "tts") return steps.storyboard?.status === "completed";
    if (step === "image") return steps.storyboard?.status === "completed";
    // video needs both image and tts
    if (step === "video") {
      return steps.image?.status === "completed" && steps.tts?.status === "completed";
    }
    return steps[STEP_ORDER[idx - 1]]?.status === "completed";
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b bg-white px-6 py-4 flex items-center gap-4">
        <Link href="/projects" className="text-sm text-zinc-500 hover:text-zinc-800">← 项目列表</Link>
        <span className="text-zinc-300">|</span>
        <h1 className="text-lg font-semibold">{state.title} — {state.episode}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-zinc-500">自动模式</span>
          <button
            onClick={toggleAutoMode}
            className={`w-10 h-5 rounded-full transition-colors ${autoMode ? "bg-blue-500" : "bg-zinc-300"}`}
          >
            <span className={`block w-4 h-4 bg-white rounded-full mx-0.5 transition-transform ${autoMode ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {STEP_ORDER.map((step, idx) => {
          const stepState = steps[step];
          const status = stepState?.status ?? "pending";
          const isActive = status === "in_progress" || status === "completed";

          return (
            <div key={step} className="bg-white border rounded-lg overflow-hidden">
              {/* Step header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b">
                <span className={`text-lg font-mono w-5 ${STATUS_COLORS[status]}`}>
                  {STATUS_ICONS[status]}
                </span>
                <span className="text-sm text-zinc-400 w-4">{idx + 1}</span>
                <span className="font-medium">{STEP_LABELS[step]}</span>
                <Badge
                  className={`ml-auto text-xs ${
                    status === "completed" ? "bg-green-100 text-green-700" :
                    status === "in_progress" ? "bg-blue-100 text-blue-700" :
                    status === "failed" ? "bg-red-100 text-red-700" :
                    "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {status === "completed" ? "已完成" :
                   status === "in_progress" ? "执行中" :
                   status === "failed" ? "失败" : "待执行"}
                </Badge>
              </div>

              {/* Step content */}
              <div className="px-5 py-4">
                <StepContent step={step} projectId={projectId} status={status} isActive={isActive} />
              </div>

              {/* Step actions */}
              {(status === "pending" || status === "failed") && (
                <div className="px-5 pb-4 flex justify-end">
                  <Button
                    size="sm"
                    disabled={!canStart(step) || starting === step}
                    onClick={() => startStep(step)}
                  >
                    {starting === step ? "启动中..." :
                     status === "failed" ? "重试" :
                     canStart(step) ? "开始执行" : "等待前序步骤"}
                  </Button>
                </div>
              )}

              {/* Confirm to proceed (non-auto mode, step completed) */}
              {status === "completed" && !autoMode && idx < STEP_ORDER.length - 1 && (
                (() => {
                  const nextStep = STEP_ORDER[idx + 1];
                  const nextStatus = steps[nextStep]?.status;
                  if (nextStatus !== "pending") return null;
                  return (
                    <div className="px-5 pb-4 flex justify-end border-t pt-3">
                      <Button
                        size="sm"
                        disabled={!canStart(nextStep) || starting === nextStep}
                        onClick={() => startStep(nextStep)}
                      >
                        确认并继续 → {STEP_LABELS[nextStep]}
                      </Button>
                    </div>
                  );
                })()
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
