# 08 — 步骤级生命周期控制设计

> **文档编号**：08
> **关联文档**：07-webui-design.md（Web UI 设计）、01-services-overview.md（服务层设计）
> **目标**：为 Pipeline 每个步骤增加暂停(pause)、启动/继续(start/resume)、停止(stop)能力
>
> ⚠️ **重要说明**：本文档描述了完整的 pause/resume/stop 设计，但 **当前代码仅实现了 stop**，pause 和 resume **未实现**（后端无对应 API 路由，前端无对应操作按钮）。请以代码实际状态为准。

---

## 1. 需求背景

现有 Pipeline 的每个步骤仅有 4 种状态：`pending` → `in_progress` → `completed`/`failed`。用户无法在执行过程中：

- **暂停**一个耗时步骤（如图片/视频生成），释放 GPU 做其他事情，稍后恢复
- **停止**一个错误频发的步骤，保留已生成的部分成果，手动修复后重新开始
- **继续**一个暂停的步骤，从断点恢复而非从头再来

**典型场景**：
1. 图片生成到第 6/10 张时，用户需要临时用 GPU 跑其他任务 → 暂停，GPU 卸载，稍后继续
2. 视频生成过程中发现 prompt 有问题 → 停止，修改 storyboard.json，重试
3. TTS 生成中遇到网络波动 → 暂停，等待网络恢复，继续

---

## 2. 状态机设计

### 2.1 扩展状态枚举

```typescript
// 前端 + 后端统一
export type StepStatus = 
  | "pending"      // 等待执行
  | "in_progress"  // 执行中
  | "paused"       // 【新增】已暂停，可恢复
  | "stopped"      // 【新增】已停止，可重新开始
  | "completed"    // 已完成
  | "failed";      // 失败（可重试）
```

### 2.2 状态转换图

```
                    ┌─────────────┐
         ┌─────────│   pending   │◀──────────────┐
         │ start   └──────┬──────┘               │
         │                │ start                │ restart
         ▼                ▼                      │
   ┌──────────┐    ┌──────────┐           ┌──────────┐
   │ stopped  │    │in_progress│           │ failed   │
   └────┬─────┘    └────┬─────┘           └────┬─────┘
        │               │                      │
        │ stop          │ pause                │ retry
        │               ▼                      │
        │         ┌──────────┐                 │
        └────────▶│ paused   │─────────────────┘
                  └────┬─────┘  resume / fail
                       │
                       ▼
                 ┌──────────┐
                 │completed │
                 └──────────┘
```

**转换规则**：

| 当前状态 | 允许操作 | 目标状态 | 说明 |
|---------|---------|---------|------|
| pending | start | in_progress | 首次启动 |
| in_progress | pause | paused | 挂起执行，保留上下文 |
| in_progress | stop | stopped | 终止执行，保留已产出 |
| in_progress | (自然完成) | completed | 正常结束 |
| in_progress | (异常) | failed | 出错，可重试 |
| paused | resume | in_progress | 从断点恢复 |
| paused | stop | stopped | 终止暂停中的任务 |
| stopped | restart | in_progress | 重新执行（利用断点续传） |
| failed | retry | in_progress | 重新执行（同 restart） |
| completed | — | — | 终态，不可操作 |

---

## 3. 技术架构

### 3.1 整体交互流程

```
┌─────────────┐      POST /pause          ┌──────────────┐      POST /pause        ┌──────────────────┐
│   Browser   │──────────────────────────▶│  Next.js API │───────────────────────▶│ FastAPI Service  │
│             │◀──────────────────────────│   Routes     │◀───────────────────────│  (JobManager)    │
└─────────────┘   200 OK { status: paused}└──────────────┘   200 OK { status: paused}└──────────────────┘
       │                                           │                                          │
       │ SSE: progress (paused indicator)          │                                          │
       │◀──────────────────────────────────────────│◀─────────────────────────────────────────│
       │                                           │                                          │
       │ POST /resume                              │ POST /resume                             │ resume task
       │──────────────────────────────────────────▶──────────────────────────────────────────▶│
       │                                           │                                          │
```

### 3.2 层级职责

| 层级 | 职责 | 文件 |
|------|------|------|
| **前端 UI** | 显示操作按钮、状态变化、实时进度 | `apps/web/app/projects/[id]/page.tsx` |
| **前端 Hooks** | 调用 API、管理本地状态 | `apps/web/hooks/useStepControl.ts`（新增） |
| **API Routes** | 接收请求、转发到服务、更新 state.json | `apps/web/app/api/pipeline/[id]/[step]/` |
| **服务层 (Python)** | 管理 Job 生命周期：pause/resume/stop | `services/shared/job_manager.py` |
| **Job Handler** | 检查暂停标志、支持断点续传 | `services/*/job_handler.py` |

---

## 4. 后端设计（Python 服务层）

### 4.1 JobManager 扩展

**文件**：`services/shared/job_manager.py`

**新增内容**：

```python
class JobStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"           # 【新增】
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobRecord:
    def __init__(self, ...):
        # ... existing fields ...
        self._pause_event = asyncio.Event()      # 【新增】用于暂停/恢复
        self._pause_event.set()                  # 默认允许执行
        self._stop_requested = False             # 【新增】停止请求标志

    async def check_pause(self):
        """Job handler 在每个工作单元后调用，如果暂停则阻塞等待"""
        if self._stop_requested:
            raise asyncio.CancelledError("Stop requested")
        await self._pause_event.wait()

    def pause(self):
        self.status = JobStatus.PAUSED
        self._pause_event.clear()
        self._touch()

    def resume(self):
        self.status = JobStatus.IN_PROGRESS
        self._pause_event.set()
        self._touch()

    def request_stop(self):
        self._stop_requested = True
        self._pause_event.set()  # 如果正在暂停中，唤醒它以便检查停止标志
        self._touch()
```

**JobManager 新增方法**：

```python
class JobManager:
    async def pause(self, job_id: str):
        job = self.get(job_id)
        if job.status != JobStatus.IN_PROGRESS:
            raise HTTPException(409, f"Cannot pause job in status {job.status}")
        job.pause()

    async def resume(self, job_id: str):
        job = self.get(job_id)
        if job.status != JobStatus.PAUSED:
            raise HTTPException(409, f"Cannot resume job in status {job.status}")
        job.resume()

    async def stop(self, job_id: str):
        job = self.get(job_id)
        if job.status not in (JobStatus.IN_PROGRESS, JobStatus.PAUSED):
            raise HTTPException(409, f"Cannot stop job in status {job.status}")
        job.request_stop()
        if job._task and not job._task.done():
            job._task.cancel()
        job.status = JobStatus.CANCELLED  # 使用 CANCELLED 表示 stopped
        job._touch()
```

### 4.2 Job Handler 改造

每个 `job_handler.py` 在循环体中插入 `await job.check_pause()`：

**示例：image-service**

```python
async def run_generate_images_job(job, project_id, config, provider):
    # ... setup ...
    for shot in shots:
        await job.check_pause()  # 【新增】检查暂停/停止
        
        # ... existing logic ...
        if output_path.exists():
            job.done += 1
            await job.emit_progress(...)
            continue
        
        await provider.generate_shot(...)
        job.done += 1
        await job.emit_progress(...)
    
    await job.emit_complete({...})
```

**改造清单**：

| 服务 | 文件 | 检查点位置 |
|------|------|-----------|
| storyboard | `services/storyboard/job_handler.py` | LLM 调用前 |
| image | `services/image/job_handler.py` | 每个 shot 生成前 |
| tts | `services/tts/job_handler.py` | 每个 track 生成前 |
| video | `services/video/job_handler.py` | 每个 clip 生成前 |
| assembly | `services/assembly/job_handler.py` | 每个阶段（素材检查/冻结帧/拼接/混音）前 |

### 4.3 FastAPI 路由扩展

每个 `main.py` 新增路由（以 image-service 为例，其他服务相同）：

```python
@app.post("/jobs/{job_id}/pause", status_code=200)
async def pause_job(job_id: str):
    await job_manager.pause(job_id)
    return {"job_id": job_id, "status": "paused"}

@app.post("/jobs/{job_id}/resume", status_code=200)
async def resume_job(job_id: str):
    await job_manager.resume(job_id)
    return {"job_id": job_id, "status": "in_progress"}

@app.post("/jobs/{job_id}/stop", status_code=200)
async def stop_job(job_id: str):
    await job_manager.stop(job_id)
    return {"job_id": job_id, "status": "stopped"}
```

### 4.4 SSE 扩展

暂停/恢复/停止时通过 SSE 通知前端：

```python
# JobRecord 的 pause/resume/stop 方法中增加广播
async def pause(self):
    self.status = JobStatus.PAUSED
    self._pause_event.clear()
    await self._broadcast("paused", {"message": "Job paused by user"})
    self._touch()

async def resume(self):
    self.status = JobStatus.IN_PROGRESS
    self._pause_event.set()
    await self._broadcast("resumed", {"message": "Job resumed"})
    self._touch()
```

SSE 事件类型扩展：

| 事件名 | 触发时机 | 数据 |
|--------|---------|------|
| `progress` | 每个工作单元完成 | `{done, total, message, ...}` |
| `paused` | 用户点击暂停 | `{message}` |
| `resumed` | 用户点击继续 | `{message}` |
| `complete` | 全部完成 | `{result}` |
| `error` | 出错 | `{message, retryable}` |
| `stopped` | 用户点击停止 | `{message, done, total}` |

---

## 5. 前端设计（Next.js）

### 5.1 状态扩展

**文件**：`apps/web/lib/project-store.ts`

```typescript
export type StepStatus = "pending" | "in_progress" | "paused" | "stopped" | "completed" | "failed";
```

**StepState 结构不变**，`status` 字段值扩展即可。

### 5.2 新增 Hook

**文件**：`apps/web/hooks/useStepControl.ts`（新增）

```typescript
"use client";
import { useState, useCallback } from "react";
import { StepName } from "@/lib/services";

export function useStepControl(projectId: string, mutateState: () => Promise<void>) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const setLoadingFor = (step: StepName, value: boolean) => {
    setLoading(prev => ({ ...prev, [step]: value }));
  };

  const pauseStep = useCallback(async (step: StepName) => {
    setLoadingFor(step, true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/${step}/pause`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await mutateState();
    } finally {
      setLoadingFor(step, false);
    }
  }, [projectId, mutateState]);

  const resumeStep = useCallback(async (step: StepName) => {
    setLoadingFor(step, true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/${step}/resume`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await mutateState();
    } finally {
      setLoadingFor(step, false);
    }
  }, [projectId, mutateState]);

  const stopStep = useCallback(async (step: StepName) => {
    setLoadingFor(step, true);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/${step}/stop`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await mutateState();
    } finally {
      setLoadingFor(step, false);
    }
  }, [projectId, mutateState]);

  return { pauseStep, resumeStep, stopStep, loading };
}
```

### 5.3 API Routes 新增

**文件**：`apps/web/app/api/pipeline/[id]/[step]/pause/route.ts`（新增）

```typescript
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
  const res = await fetch(`${serviceUrl}/jobs/${jobId}/pause`, { method: "POST" });
  
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }

  await updateStep(projectId, stepName, { status: "paused" });
  return NextResponse.json({ status: "paused" });
}
```

**resume** 和 **stop** 路由结构相同，分别调用服务的 `/jobs/{job_id}/resume` 和 `/jobs/{job_id}/stop`，并更新 state.json。

### 5.4 UI 更新

**文件**：`apps/web/app/projects/[id]/page.tsx`

**StepCard 操作区改造**：

```
┌────────────────────────────────────────────────────────┐
│ ④ 视频生成                                    执行中   │
├────────────────────────────────────────────────────────┤
│ ████████░░░░░░░░░░  2/10                               │
│ 当前：E01_003 生成中...（约 5 分钟/片段）             │
├────────────────────────────────────────────────────────┤
│                              [⏸ 暂停]  [■ 停止]       │
└────────────────────────────────────────────────────────┘
```

**不同状态的操作按钮**：

| 状态 | 显示按钮 | 说明 |
|------|---------|------|
| pending | `[开始执行]` | 同现有逻辑 |
| in_progress | `[⏸ 暂停] [■ 停止]` | 【新增】 |
| paused | `[▶ 继续] [■ 停止]` | 【新增】继续或终止 |
| stopped | `[重新开始]` | 【新增】利用断点续传 |
| failed | `[重试]` | 同现有逻辑 |
| completed | `[确认并继续 →]` | 同现有逻辑 |

**STATUS_ICONS 和 STATUS_COLORS 扩展**：

```typescript
const STATUS_ICONS: Record<string, string> = {
  pending:     "○",
  in_progress: "◌",
  paused:      "⏸",      // 【新增】
  stopped:     "■",      // 【新增】
  completed:   "✓",
  failed:      "✗",
};

const STATUS_COLORS: Record<string, string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-500",
  paused:      "text-amber-500",    // 【新增】琥珀色
  stopped:     "text-orange-500",   // 【新增】橙色
  completed:   "text-green-600",
  failed:      "text-red-500",
};
```

### 5.5 SSE Hook 扩展

**文件**：`apps/web/hooks/useStepProgress.ts`

新增对 `paused` / `resumed` / `stopped` 事件的处理：

```typescript
export interface StepProgress {
  events: ProgressEvent[];
  lastEvent: ProgressEvent | null;
  isComplete: boolean;
  isPaused: boolean;       // 【新增】
  isStopped: boolean;      // 【新增】
  error: string | null;
  percent: number;
}

// useEffect 中增加事件监听
es.addEventListener("paused", () => {
  setIsPaused(true);
});

es.addEventListener("resumed", () => {
  setIsPaused(false);
});

es.addEventListener("stopped", () => {
  setIsStopped(true);
  setIsComplete(true);
});
```

---

## 6. 断点续传机制

### 6.1 核心原则

暂停/停止后重新开始时，**利用已生成的文件自动跳过**，无需额外实现状态持久化。

### 6.2 各服务断点续传逻辑

| 服务 | 断点判断依据 | 跳过逻辑 |
|------|------------|---------|
| storyboard | `storyboard.json` 是否存在 | 已存在则直接读取（但 storyboard 通常很快，不常暂停） |
| image | `images/{shot_id}.png` 是否存在且非空 | 存在则跳过该 shot |
| tts | `audio/{shot_id}_action.mp3` / `{shot_id}_dialogue.mp3` 是否存在 | 存在则跳过该 track |
| video | `clips/{shot_id}.mp4` 是否存在且非空 | 存在则跳过该 clip |
| assembly | 无（每次都是全量重新合并）| 无断点，但每次执行都是幂等的 |

**说明**：各服务 `job_handler.py` 中已有文件存在性检查（`output_path.exists()`），暂停/停止后重新 start 会自然利用该机制。

### 6.3 状态恢复流程

```
用户点击 "重新开始"（stopped 状态）
    │
    ▼
POST /api/pipeline/[id]/[step]/start
    │
    ▼
服务层创建新 Job
    │
    ▼
Job handler 遍历 shots/tracks
    │
    ├── 文件已存在 → emit_progress(skipped=true) → 跳过
    │
    └── 文件不存在 → 正常生成
    │
    ▼
最终 emit_complete
```

---

## 7. 边界情况处理

### 7.1 暂停期间浏览器刷新

**问题**：用户暂停后刷新页面，SSE 连接断开，如何恢复暂停状态？

**方案**：
1. SWR 轮询（5s）会读取 `state.json`，其中 `status: "paused"` 会正确显示
2. 但 SSE 实时流已断开，暂停期间的 `paused` 事件不会重放
3. **解决**：前端根据 `state.status === "paused"` 自动显示暂停 UI，无需依赖 SSE 事件

### 7.2 服务重启后恢复

**问题**：服务进程重启后，内存中的 Job 对象丢失。

**方案**（已实现）：
- **不实现跨进程恢复**（v1.0 范围）
- 服务重启后，Job 丢失，`state.json` 中的 `job_id` 指向不存在的 job
- 前端 pause/resume 路由收到 404 时，自动将步骤状态改为 `stopped`，返回友好提示"任务已失效，请点击重新开始"
- stop 路由收到 404 时，直接视为停止成功（不报错）
- 用户点击"重新开始"，利用断点续传机制自动跳过已生成文件

### 7.3 多个步骤同时暂停

**问题**：image 和 tts 同时在运行（并行），用户暂停其中一个。

**方案**：
- 各服务独立管理自己的 Job，互不影响
- 暂停 image 不会影响 tts 的继续执行
- 这是预期行为：用户可能想暂停耗 GPU 的 image，让 CPU 的 tts 继续跑

### 7.4 自动模式与暂停的交互

**问题**：自动模式下，某步骤被用户暂停，是否还自动推进？

**方案**：
- **暂停状态阻塞自动推进**：`autoMode` 仅在步骤为 `completed` 时触发下一步
- 如果步骤为 `paused`，`autoMode` 不会触发任何操作
- 用户 resume 后，该步骤继续执行，完成后如果 autoMode 开启，正常触发下一步

### 7.5 GPU 释放（暂停时）

**问题**：暂停 image/video 步骤后，模型仍占用 GPU 显存。

**方案**：
- **v1.0 不实现暂停时自动卸载模型**（复杂度较高）
- 暂停仅停止生成新 shot，模型保持在 GPU 中
- 如果用户需要释放 GPU，应使用**停止**（stop），然后手动调用 `/model/unload`
- **v1.1 可考虑**：暂停时自动卸载模型，恢复时重新加载（需记录加载状态）

---

## 8. 实现清单

### 8.1 后端（Python）

| # | 文件 | 变更 | 说明 |
|---|------|------|------|
| 1 | `services/shared/job_manager.py` | 修改 | 新增 PAUSED 状态、pause/resume/stop 方法、check_pause |
| 2 | `services/storyboard/main.py` | 修改 | 新增 /jobs/{id}/pause、/resume、/stop 路由 |
| 3 | `services/storyboard/job_handler.py` | 修改 | 增加 await job.check_pause() |
| 4 | `services/image/main.py` | 修改 | 新增 /jobs/{id}/pause、/resume、/stop 路由 |
| 5 | `services/image/job_handler.py` | 修改 | 增加 await job.check_pause() |
| 6 | `services/tts/main.py` | 修改 | 新增 /jobs/{id}/pause、/resume、/stop 路由 |
| 7 | `services/tts/job_handler.py` | 修改 | 增加 await job.check_pause() |
| 8 | `services/video/main.py` | 修改 | 新增 /jobs/{id}/pause、/resume、/stop 路由 |
| 9 | `services/video/job_handler.py` | 修改 | 增加 await job.check_pause() |
| 10 | `services/assembly/main.py` | 修改 | 新增 /jobs/{id}/pause、/resume、/stop 路由 |
| 11 | `services/assembly/job_handler.py` | 修改 | 增加 await job.check_pause() |

### 8.2 前端（Next.js）— 部分实现

| # | 文件 | 变更 | 说明 |
|---|---|------|------|
| 1 | `apps/web/lib/project-store.ts` | ✅ | 扩展 StepStatus 类型 |
| 2 | `apps/web/hooks/useStepControl.ts` | ⚠️ | **仅 stop**，pause/resume **未实现** |
| 3 | `apps/web/hooks/useStepProgress.ts` | ✅ | 处理 stopped SSE 事件；active 变 true 时重置 isComplete |
| 4 | `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts` | ❌ | **不存在** |
| 5 | `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts` | ❌ | **不存在** |
| 6 | `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` | ✅ | 停止 API（404 视为成功） |
| 7 | `apps/web/app/projects/[id]/page.tsx` | ✅ | 新增 stop 操作按钮、状态显示 |

### 8.3 文档

| # | 文件 | 变更 | 说明 |
|---|------|------|------|
| 1 | `docs/technical/design/08-step-lifecycle-control.md` | 新增 | 本文档 |
| 2 | `docs/technical/design/07-webui-design.md` | 修改 | 补充暂停/启动/停止 UI 设计 |
| 3 | `HANDOFF.md` | 修改 | 更新进度和功能清单 |

---

## 9. 时序图

### 9.1 暂停与恢复

```
User     Browser    Next.js    image-service    JobManager    FluxProvider
 │          │          │             │              │              │
 │ 点击暂停  │          │             │              │              │
 │─────────▶│          │             │              │              │
 │          │ POST /pause            │              │              │
 │          │───────────────────────▶│              │              │
 │          │          │  POST /jobs/{id}/pause      │              │
 │          │          │───────────────────────────▶│              │
 │          │          │             │   job.pause()│              │
 │          │          │             │─────────────▶│              │
 │          │          │             │              │ _pause_event.clear()
 │          │          │             │◀─────────────│              │
 │          │          │◀────────────│              │              │
 │          │◀─────────│             │              │              │
 │          │ SSE: paused            │              │              │
 │          │◀───────────────────────│              │              │
 │          │          │             │              │              │
 │          │          │             │              │              │
 │          │          │             │  (current shot finishes)   │
 │          │          │             │              │              │
 │          │          │             │ await check_pause()        │
 │          │          │             │              │ blocks here  │
 │          │          │             │              │              │
 │ 点击继续  │          │             │              │              │
 │─────────▶│          │             │              │              │
 │          │ POST /resume           │              │              │
 │          │───────────────────────▶│              │              │
 │          │          │ POST /jobs/{id}/resume      │              │
 │          │          │───────────────────────────▶│              │
 │          │          │             │  job.resume()│              │
 │          │          │             │─────────────▶│              │
 │          │          │             │              │ _pause_event.set()
 │          │          │             │              │ unblock     │
 │          │          │             │              │─────────────▶│
 │          │          │             │              │              │ next shot...
```

### 9.2 停止后重新开始

```
User     Browser    Next.js    image-service    JobManager
 │          │          │             │              │
 │ 点击停止  │          │             │              │
 │─────────▶│          │             │              │
 │          │ POST /stop             │              │
 │          │───────────────────────▶│              │
 │          │          │ POST /jobs/{id}/stop        │
 │          │          │───────────────────────────▶│
 │          │          │             │ job.stop()   │
 │          │          │             │─────────────▶│
 │          │          │             │              │ task.cancel()
 │          │          │             │              │ status=stopped
 │          │          │◀────────────│              │
 │          │◀─────────│             │              │
 │          │ SSE: stopped           │              │
 │          │◀───────────────────────│              │
 │          │          │             │              │
 │ 点击重新开始         │             │              │
 │─────────▶│          │             │              │
 │          │ POST /start            │              │
 │          │───────────────────────▶│              │
 │          │          │ POST /jobs (new job)        │
 │          │          │───────────────────────────▶│
 │          │          │             │              │ new JobRecord
 │          │          │             │              │
 │          │          │             │ (job handler skips existing files)
 │          │          │             │ emit_progress(skipped=true)
 │          │          │             │ (generates missing files)
 │          │          │             │ emit_progress(done=N)
 │          │          │             │ emit_complete()
```

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **暂停期间模型占用 GPU** | 暂停后显存未释放 | v1.0 文档说明：暂停不卸载模型，需停止+unload 才能释放 |
| **服务重启丢失 Job** | 无法恢复暂停的任务 | 利用断点续传，重新开始即可自动跳过已生成文件 |
| **并发操作冲突** | 用户快速点击暂停/恢复导致状态错乱 | UI 按钮加 loading 状态，禁用重复点击 |
| **停止后部分文件损坏** | 正在写入的文件可能不完整 | 各服务使用原子写入（tmp → rename），不会出现半写文件 |
| **SSE 断线后状态不同步** | 刷新页面后不知道已暂停 | SWR 轮询读取 state.json 纠正状态 |

---

*本文档由 Sisyphus Agent 创建*  
*创建时间：2026-04-20*  
*关联任务：步骤级暂停/启动/停止功能设计与文档*
