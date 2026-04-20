"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useProjectState } from "@/hooks/useProjectState";
import { useStepProgress } from "@/hooks/useStepProgress";
import { useStepControl } from "@/hooks/useStepControl";
import { STEP_ORDER, STEP_LABELS, StepName } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StepArtifacts } from "@/components/step-artifacts";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { StepResult } from "@/lib/project-store";

// ── Auto-mode hook ─────────────────────────────────────────────────────────────
function useAutoMode(projectId: string) {
  const key = `auto-mode-${projectId}`;
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(key) === "true";
  });
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
  paused:      "⏸",
  stopped:     "■",
  completed:   "✓",
  failed:      "✗",
};
const STATUS_COLORS: Record<string, string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-500",
  paused:      "text-amber-500",
  stopped:     "text-orange-500",
  completed:   "text-green-600",
  failed:      "text-red-500",
};

// ── Step content ───────────────────────────────────────────────────────────────
function StepContent({
  step,
  projectId,
  status,
  progress,
}: {
  step: StepName;
  projectId: string;
  status: string;
  progress: ReturnType<typeof useStepProgress>;
}) {

  if (status === "pending") {
    return <p className="text-sm text-zinc-400">等待执行</p>;
  }

  if (status === "in_progress" || status === "paused") {
    return (
      <div className="space-y-2">
        <Progress value={progress.percent} className="h-2" />
        <p className="text-sm text-zinc-600">
          {progress.lastEvent?.message ?? progress.lastEvent?.phase ?? "处理中..."}
          {progress.lastEvent?.done !== undefined && progress.lastEvent?.total
            ? ` (${progress.lastEvent.done}/${progress.lastEvent.total})`
            : ""}
        </p>
        {status === "paused" && (
          <p className="text-sm text-amber-600">已暂停，点击继续恢复执行</p>
        )}
        {progress.error && (
          <p className="text-sm text-red-500">{progress.error}</p>
        )}
      </div>
    );
  }

  if (status === "stopped") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-orange-600">
          任务已停止。已生成的文件将被保留，重新开始将自动跳过已存在的文件。
        </p>
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

// ── Step artifacts wrapper ─────────────────────────────────────────────────────
function StepArtifactsWrapper({
  step,
  projectId,
  status,
  result,
  progressArtifacts,
  onRegenerateItem,
}: {
  step: StepName;
  projectId: string;
  status: string;
  result?: StepResult | null;
  progressArtifacts?: ReturnType<typeof useStepProgress>["artifacts"];
  onRegenerateItem?: (shot_id: string) => void;
}) {
  const show = ["completed", "stopped", "in_progress", "paused"].includes(status);
  if (!show) return null;
  // During active execution, suppress the old persisted result so live progress
  // artifacts are shown instead (avoids stale artifacts after a step restart).
  const activelyRunning = ["in_progress", "paused"].includes(status);
  const displayResult = activelyRunning ? null : result;
  const hasContent = !!displayResult || (progressArtifacts && progressArtifacts.length > 0);
  if (!hasContent) return null;
  return (
    <div className="mt-4 pt-4 border-t">
      <StepArtifacts
        step={step}
        result={displayResult}
        projectId={projectId}
        progressArtifacts={progressArtifacts}
        onRegenerateItem={activelyRunning ? undefined : onRegenerateItem}
      />
    </div>
  );
}

// ── Step card (one step, owns its progress hook) ──────────────────────────────
type StepStateType = { status: string; job_id: string | null; result?: StepResult | null };

function StepCard({
  step,
  idx,
  projectId,
  stepState,
  allSteps,
  autoMode,
  starting,
  controlLoading,
  controlErrors,
  onStart,
  onPause,
  onResume,
  onStop,
  onRegenerate,
  onRegenerateItem,
}: {
  step: StepName;
  idx: number;
  projectId: string;
  stepState: StepStateType;
  allSteps: Record<StepName, StepStateType>;
  autoMode: boolean;
  starting: StepName | null;
  controlLoading: Record<string, boolean>;
  controlErrors: Record<string, string>;
  onStart: (step: StepName) => void;
  onPause: (step: StepName) => void;
  onResume: (step: StepName) => void;
  onStop: (step: StepName) => void;
  onRegenerate: (step: StepName) => Promise<void>;
  onRegenerateItem: (step: StepName, shot_id: string) => Promise<void>;
}) {
  const status = stepState?.status ?? "pending";
  const isActive = ["in_progress", "paused", "stopped", "completed"].includes(status);
  // Single hook call — shared between StepContent and StepArtifactsWrapper
  const progress = useStepProgress(
    projectId,
    step,
    isActive && (status === "in_progress" || status === "paused"),
  );

  function canStart(): boolean {
    const s = stepState?.status;
    if (s !== "pending" && s !== "failed" && s !== "stopped") return false;
    const i = STEP_ORDER.indexOf(step);
    if (i === 0) return true;
    if (step === "tts") return allSteps.storyboard?.status === "completed";
    if (step === "image") return allSteps.storyboard?.status === "completed";
    if (step === "video") {
      return allSteps.image?.status === "completed" && allSteps.tts?.status === "completed";
    }
    return allSteps[STEP_ORDER[i - 1]]?.status === "completed";
  }

  const nextStep = STEP_ORDER[idx + 1] as StepName | undefined;
  const canRegen = status === "completed" || status === "stopped" || status === "failed";

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
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
            status === "paused" ? "bg-amber-100 text-amber-700" :
            status === "stopped" ? "bg-orange-100 text-orange-700" :
            status === "failed" ? "bg-red-100 text-red-700" :
            "bg-zinc-100 text-zinc-500"
          }`}
        >
          {status === "completed" ? "已完成" :
           status === "in_progress" ? "执行中" :
           status === "paused" ? "已暂停" :
           status === "stopped" ? "已停止" :
           status === "failed" ? "失败" : "待执行"}
        </Badge>
      </div>

      {/* Step content + artifacts */}
      <div className="px-5 py-4">
        <StepContent step={step} projectId={projectId} status={status} progress={progress} />
        <StepArtifactsWrapper
          step={step}
          projectId={projectId}
          status={status}
          result={stepState.result}
          progressArtifacts={progress.artifacts}
          onRegenerateItem={(shot_id) => onRegenerateItem(step, shot_id)}
        />
      </div>

      {/* Step actions */}
      {(status === "pending" || status === "failed" || status === "stopped") && (
        <div className="px-5 pb-4 flex justify-end">
          <Button
            size="sm"
            disabled={!canStart() || starting === step || controlLoading[step]}
            onClick={() => onStart(step)}
          >
            {starting === step ? "启动中..." :
             controlLoading[step] ? "处理中..." :
             status === "failed" ? "重试" :
             status === "stopped" ? "重新开始" :
             canStart() ? "开始执行" : "等待前序步骤"}
          </Button>
        </div>
      )}

      {status === "in_progress" && (
        <div className="px-5 pb-4 space-y-2">
          {controlErrors[step] && (
            <p className="text-xs text-red-500 text-right">{controlErrors[step]}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={!!controlLoading[step]} onClick={() => onPause(step)}>
              {controlLoading[step] ? "处理中..." : "⏸ 暂停"}
            </Button>
            <Button size="sm" variant="destructive" disabled={!!controlLoading[step]} onClick={() => onStop(step)}>
              {controlLoading[step] ? "处理中..." : "■ 停止"}
            </Button>
          </div>
        </div>
      )}

      {status === "paused" && (
        <div className="px-5 pb-4 space-y-2">
          {controlErrors[step] && (
            <p className="text-xs text-red-500 text-right">{controlErrors[step]}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={!!controlLoading[step]} onClick={() => onResume(step)}>
              {controlLoading[step] ? "处理中..." : "▶ 继续"}
            </Button>
            <Button size="sm" variant="destructive" disabled={!!controlLoading[step]} onClick={() => onStop(step)}>
              {controlLoading[step] ? "处理中..." : "■ 停止"}
            </Button>
          </div>
        </div>
      )}

      {/* Bottom actions bar (completed / stopped / failed) */}
      {canRegen && (
        <div className="px-5 pb-4 flex items-center justify-between border-t pt-3 gap-2">
          {/* Regenerate all */}
          <ConfirmDialog
            title={`重新生成「${STEP_LABELS[step]}」`}
            description={
              <span>
                此操作将删除该阶段所有已生成产物，且
                <span className="text-red-600 font-medium">不可恢复</span>
                。确认后将立即重新执行。
              </span>
            }
            confirmLabel="确认重新生成"
            trigger={
              <Button size="sm" variant="outline" className="text-zinc-500 hover:text-blue-600 hover:border-blue-300">
                ↺ 重新生成全部
              </Button>
            }
            onConfirm={() => onRegenerate(step)}
          />

          {/* Continue to next step (non-auto mode, completed only) */}
          {status === "completed" && !autoMode && nextStep && (() => {
            const nextStatus = allSteps[nextStep]?.status;
            if (nextStatus !== "pending" && nextStatus !== "stopped") return null;
            const nextCanStart =
              nextStep === "tts" ? allSteps.storyboard?.status === "completed" :
              nextStep === "image" ? allSteps.storyboard?.status === "completed" :
              nextStep === "video" ? allSteps.image?.status === "completed" && allSteps.tts?.status === "completed" :
              true;
            return (
              <Button
                size="sm"
                disabled={!nextCanStart || starting === nextStep}
                onClick={() => onStart(nextStep)}
              >
                确认并继续 → {STEP_LABELS[nextStep]}
              </Button>
            );
          })()}
        </div>
      )}

      {/* Continue to next step without regenerate bar (pending step completed, non-auto) */}
      {!canRegen && status === "completed" && !autoMode && nextStep && (() => {
        const nextStatus = allSteps[nextStep]?.status;
        if (nextStatus !== "pending" && nextStatus !== "stopped") return null;
        const nextCanStart =
          nextStep === "tts" ? allSteps.storyboard?.status === "completed" :
          nextStep === "image" ? allSteps.storyboard?.status === "completed" :
          nextStep === "video" ? allSteps.image?.status === "completed" && allSteps.tts?.status === "completed" :
          true;
        return (
          <div className="px-5 pb-4 flex justify-end border-t pt-3">
            <Button
              size="sm"
              disabled={!nextCanStart || starting === nextStep}
              onClick={() => onStart(nextStep)}
            >
              确认并继续 → {STEP_LABELS[nextStep]}
            </Button>
          </div>
        );
      })()}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { state, mutate } = useProjectState(projectId);
  const { pauseStep, resumeStep, stopStep, loading: controlLoading, errors: controlErrors } = useStepControl(projectId, mutate);
  const [autoMode, toggleAutoMode] = useAutoMode(projectId);
  const [starting, setStarting] = useState<StepName | null>(null);
  const autoRef = useRef(autoMode);
  autoRef.current = autoMode;

  // Auto-advance: when a step completes, start the next one
  useEffect(() => {
    if (!state || !autoRef.current) return;
    const steps = state.steps as Record<StepName, { status: string }>;
    for (let i = 0; i < STEP_ORDER.length - 1; i++) {
      const cur = STEP_ORDER[i];
      const next = STEP_ORDER[i + 1];
      if (steps[cur]?.status === "completed" && steps[next]?.status === "pending") {
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

  /** Reset all artifacts for a step, then restart it (step-level regeneration). */
  async function regenerateStep(step: StepName) {
    const res = await fetch(`/api/pipeline/${projectId}/${step}/reset`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `重置失败（${res.status}）`);
    }
    await startStep(step);
  }

  /** Delete a single artifact and restart the step (per-item regeneration). */
  async function regenerateItem(step: StepName, shot_id: string) {
    const res = await fetch(`/api/pipeline/${projectId}/${step}/regenerate-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shot_id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `重新生成失败（${res.status}）`);
    }
    await startStep(step);
  }

  if (!state) {
    return <div className="p-8 text-zinc-400">加载中...</div>;
  }

  const steps = state.steps as Record<StepName, StepStateType>;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b bg-white px-6 py-4 flex items-center gap-4">
        <Link href="/projects" className="text-sm text-zinc-500 hover:text-zinc-800">← 项目列表</Link>
        <span className="text-zinc-300">|</span>
        <h1 className="text-lg font-semibold">{state.title} — {state.episode}</h1>
        <div className="ml-auto flex items-center gap-3">
          <DeleteProjectDialog
            projectId={projectId}
            projectTitle={`${state.title} — ${state.episode}`}
            trigger={
              <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-red-500 hover:bg-red-50">
                删除项目
              </Button>
            }
          />
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
        {STEP_ORDER.map((step, idx) => (
          <StepCard
            key={step}
            step={step}
            idx={idx}
            projectId={projectId}
            stepState={steps[step]}
            allSteps={steps}
            autoMode={autoMode}
            starting={starting}
            controlLoading={controlLoading}
            controlErrors={controlErrors}
            onStart={startStep}
            onPause={pauseStep}
            onResume={resumeStep}
            onStop={stopStep}
            onRegenerate={regenerateStep}
            onRegenerateItem={regenerateItem}
          />
        ))}
      </main>
    </div>
  );
}
