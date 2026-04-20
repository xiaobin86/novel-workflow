"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useProjectState } from "@/hooks/useProjectState";
import { useStepProgress } from "@/hooks/useStepProgress";
import { useStepControl } from "@/hooks/useStepControl";
import { STEP_ORDER, STEP_LABELS, StepName } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StepArtifacts } from "@/components/step-artifacts";
import { StepNavigator } from "@/components/step-navigator";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { StepResult } from "@/lib/project-store";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null));

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
  stopped:     "■",
  completed:   "✓",
  failed:      "✗",
};
const STATUS_COLORS: Record<string, string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-500",
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
  progressArtifacts,
  onDeleteItem,
}: {
  step: StepName;
  projectId: string;
  status: string;
  progressArtifacts?: ReturnType<typeof useStepProgress>["artifacts"];
  onDeleteItem?: (shot_id: string) => void;
}) {
  const activelyRunning = status === "in_progress";

  // Always fetch from disk — ensures previously generated items are visible
  // even after a page refresh during in_progress.
  const { data: diskResult, mutate: mutateDisk } = useSWR<StepResult | null>(
    `/api/projects/${projectId}/artifacts/${step}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // When a new artifact is reported via progress events, re-fetch the full
  // artifact list from disk so the UI shows all items (not just new ones).
  const prevProgressLength = useRef(progressArtifacts?.length ?? 0);
  useEffect(() => {
    const currentLength = progressArtifacts?.length ?? 0;
    if (currentLength > prevProgressLength.current) {
      mutateDisk();
    }
    prevProgressLength.current = currentLength;
  }, [progressArtifacts, mutateDisk]);

  const hasContent = !!diskResult || (progressArtifacts && progressArtifacts.length > 0);
  if (!hasContent) return null;

  return (
    <div className="mt-4 pt-4 border-t">
      <StepArtifacts
        step={step}
        result={diskResult}
        projectId={projectId}
        progressArtifacts={progressArtifacts}
        onDeleteItem={activelyRunning ? undefined : onDeleteItem}
      />
    </div>
  );
}

// ── Step card (one step, owns its progress hook) ──────────────────────────────
type StepStateType = { status: string; job_id: string | null };

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
  pendingVideoShots,
  onStart,
  onStop,
  onDelete,
  onDeleteItem,
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
  pendingVideoShots: string[];
  onStart: (step: StepName) => void;
  onStop: (step: StepName) => void;
  onDelete: (step: StepName) => Promise<void>;
  onDeleteItem: (step: StepName, shot_id: string) => Promise<void>;
}) {
  const status = stepState?.status ?? "pending";
  const isActive = ["in_progress", "stopped", "completed"].includes(status);
  // Single hook call — shared between StepContent and StepArtifactsWrapper
  const progress = useStepProgress(
    projectId,
    step,
    isActive && status === "in_progress",
  );

  function canStart(): boolean {
    const s = stepState?.status;
    if (s !== "pending" && s !== "failed" && s !== "stopped" && s !== "in_progress") return false;
    const i = STEP_ORDER.indexOf(step);
    if (i === 0) return true;
    if (step === "tts") return allSteps.storyboard?.status === "completed";
    if (step === "image") return allSteps.storyboard?.status === "completed";
    if (step === "video") {
      // Enable as soon as at least one image exists without a matching video
      return pendingVideoShots.length > 0;
    }
    return allSteps[STEP_ORDER[i - 1]]?.status === "completed";
  }

  const nextStep = STEP_ORDER[idx + 1] as StepName | undefined;
  const canRegen = status === "completed" || status === "stopped" || status === "failed";

  return (
    <div id={`step-${step}`} className="bg-white border rounded-lg overflow-hidden scroll-mt-24">
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
            status === "stopped" ? "bg-orange-100 text-orange-700" :
            status === "failed" ? "bg-red-100 text-red-700" :
            "bg-zinc-100 text-zinc-500"
          }`}
        >
           {status === "completed" ? "已完成" :
            status === "in_progress" ? "执行中" :
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
          progressArtifacts={progress.artifacts}
          onDeleteItem={(shot_id) => onDeleteItem(step, shot_id)}
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
             step === "video" && status === "stopped" ? `继续生成（${pendingVideoShots.length} 个）` :
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
          <div className="flex justify-end">
            <Button size="sm" variant="destructive" disabled={!!controlLoading[step]} onClick={() => onStop(step)}>
              {controlLoading[step] ? "处理中..." : "■ 停止"}
            </Button>
          </div>
        </div>
      )}

      {/* Bottom actions bar (completed / stopped / failed) */}
      {canRegen && (
        <div className="px-5 pb-4 flex items-center justify-between border-t pt-3 gap-2">
          {/* Delete all */}
          <ConfirmDialog
            title={`删除「${STEP_LABELS[step]}」全部产物`}
            description={
              <span>
                此操作将删除该阶段所有已生成产物，且
                <span className="text-red-600 font-medium">不可恢复</span>
                。
              </span>
            }
            confirmLabel="确认删除"
            trigger={
              <Button size="sm" variant="outline" className="text-zinc-500 hover:text-red-500 hover:border-red-300">
                删除全部
              </Button>
            }
            onConfirm={() => onDelete(step)}
          />

          {/* Continue to next step (non-auto mode, completed only) */}
          {status === "completed" && !autoMode && nextStep && (() => {
            const nextStatus = allSteps[nextStep]?.status;
            if (nextStatus !== "pending" && nextStatus !== "stopped") return null;
            const nextCanStart =
              nextStep === "tts" ? allSteps.storyboard?.status === "completed" :
              nextStep === "image" ? allSteps.storyboard?.status === "completed" :
              nextStep === "video" ? pendingVideoShots.length > 0 :
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
export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { state, mutate } = useProjectState(projectId);
  const { mutate: globalMutate } = useSWRConfig();
  const { stopStep, loading: controlLoading, errors: controlErrors } = useStepControl(projectId, mutate);
  const [autoMode, toggleAutoMode] = useAutoMode(projectId);

  // Pending video shots: images that exist on disk but don't have a matching clip yet.
  // Derived from state.shot_file_counts which is recomputed on every readState() call.
  const imageShotSet = new Set<string>(state?.shot_file_counts?.image_shots ?? []);
  const videoShotSet = new Set<string>(state?.shot_file_counts?.video_shots ?? []);
  const pendingVideoShots = [...imageShotSet].filter((id) => !videoShotSet.has(id));
  const [starting, setStarting] = useState<StepName | null>(null);
  const [activeStep, setActiveStep] = useState<StepName>(STEP_ORDER[0]);
  const autoRef = useRef(autoMode);
  autoRef.current = autoMode;

  // Scroll spy: highlight the step currently in view
  useEffect(() => {
    if (!state) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const stepId = visible[0].target.id.replace("step-", "") as StepName;
          setActiveStep(stepId);
        }
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 }
    );

    STEP_ORDER.forEach((step) => {
      const el = document.getElementById(`step-${step}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [state]);

  const scrollToStep = (step: StepName) => {
    document.getElementById(`step-${step}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // Auto-advance: when a step completes, start the next one
  useEffect(() => {
    if (!state || !autoRef.current) return;
    const steps = state.steps as Record<StepName, { status: string }>;
    for (let i = 0; i < STEP_ORDER.length - 1; i++) {
      const cur = STEP_ORDER[i];
      const next = STEP_ORDER[i + 1];
      if (steps[cur]?.status === "completed" && steps[next]?.status === "pending") {
        if (next === "video") {
          // Auto-start video only when there are images without clips
          if (pendingVideoShots.length === 0) continue;
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
      // For video: snapshot the pending shot list at click time so the backend
      // only processes the shots that have images right now (not future images).
      const body: Record<string, unknown> =
        step === "video" ? { shot_ids: pendingVideoShots } : {};
      await fetch(`/api/pipeline/${projectId}/${step}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  /** Delete all artifacts for a step without restarting it. */
  async function deleteStep(step: StepName) {
    const res = await fetch(`/api/pipeline/${projectId}/${step}/reset`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `删除失败（${res.status}）`);
    }
    // 先刷新项目状态，确认后端已将步骤重置为 pending（删除完成的可靠信号）
    await mutate(undefined, { revalidate: true });
    // 状态确认后再刷新产物列表，确保读取到最新磁盘状态
    await globalMutate(`/api/projects/${projectId}/artifacts/${step}`, undefined, { revalidate: true });
  }

  /** Delete a single artifact file without restarting the step. */
  async function deleteItem(step: StepName, shot_id: string) {
    const res = await fetch(`/api/pipeline/${projectId}/${step}/regenerate-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shot_id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `删除失败（${res.status}）`);
    }
    // 先刷新项目状态，确认删除操作已完成，再刷新产物列表避免读到缓存
    await mutate(undefined, { revalidate: true });
    await globalMutate(`/api/projects/${projectId}/artifacts/${step}`, undefined, { revalidate: true });
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

      <main className="max-w-[100rem] mx-auto px-8 py-8">
        <div className="flex gap-6">
          {/* Left sidebar navigation */}
          <aside className="hidden lg:block w-60 shrink-0">
            <div className="sticky top-8">
              <StepNavigator
                steps={steps}
                activeStep={activeStep}
                onStepClick={scrollToStep}
              />
            </div>
          </aside>

          {/* Right content area */}
          <div className="flex-1 space-y-4">
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
                pendingVideoShots={pendingVideoShots}
                onStart={startStep}
                onStop={stopStep}
                onDelete={deleteStep}
                onDeleteItem={deleteItem}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
