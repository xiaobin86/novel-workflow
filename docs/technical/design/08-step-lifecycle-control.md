# 08 — 步骤级生命周期控制设计

> **文档编号**：08  
> **关联文档**：07-webui-design.md（Web UI 设计）、01-services-overview.md（服务层设计）  
> **目标**：描述 Pipeline 每个步骤的停止（stop）能力与断点续传机制  
> **最后同步代码**：`develop` 分支，2026-04-21

---

## 1. 设计决策：Stop-Only，无 Pause/Resume

经过评估，本项目采用**停止（stop）+ 断点续传重启**模式，不实现暂停（pause）和恢复（resume）。

**理由：**
- 单用户本地工具，场景简单，stop 后重新 start 即可利用断点续传自动跳过已完成文件，效果等同 pause/resume
- pause/resume 需要跨进程状态持久化（服务重启后 Job 丢失），而 stop+restart 无此问题
- 实现复杂度更低，稳定性更高

---

## 2. 状态机

### 2.1 状态枚举

```typescript
// 前端 + 后端统一
export type StepStatus =
  | "pending"      // 等待执行
  | "in_progress"  // 执行中
  | "stopped"      // 已停止（已保留已产出文件，可重新开始）
  | "completed"    // 已完成
  | "failed";      // 失败（可重试）
```

### 2.2 状态转换图

```
              ┌─────────────┐
    ┌─────────│   pending   │◀──────────────────┐
    │ start   └──────┬──────┘                   │
    ▼                ▼ start                    │
┌──────────┐   ┌────────────┐   ┌──────────┐   │
│ stopped  │   │ in_progress │   │  failed  │   │
└──────┬───┘   └──┬──────┬──┘   └────┬─────┘   │
       │          │      │           │         │
       │ start    │stop  │complete   │ start   │
       │(断点续传) ▼      ▼           ▼         │
       └─────────────▶  stopped   completed ───┘
                    ↑
              reset（/reset 路由）→ pending
```

**转换规则：**

| 当前状态 | 允许操作 | 目标状态 | 说明 |
|---------|---------|---------|------|
| pending | start | in_progress | 首次启动 |
| in_progress | stop | stopped | 终止执行，保留已产出文件 |
| in_progress | (自然完成) | completed | 正常结束 |
| in_progress | (异常) | failed | 出错 |
| stopped | start | in_progress | 断点续传重启（跳过已存在文件）|
| failed | start | in_progress | 重试（同 stopped → start）|
| completed | reset | pending | 删除产物后重置（通过 /reset 路由）|

---

## 3. 技术架构

### 3.1 整体交互流程

```
User 点击停止
  │
  ▼
Browser: POST /api/pipeline/{id}/{step}/stop
  │
  ▼
Next.js API Route: 读取 job_id → POST {service}/jobs/{job_id}/stop
  │
  ▼
FastAPI JobManager.stop():
  1. job.request_stop()           → _stop_requested = True
  2. job._task.cancel()           → 触发 CancelledError
  3. job.status = CANCELLED
  4. broadcast("stopped", {...})  → SSE 通知前端
  │
  ▼
Next.js SSE 代理收到 stopped 事件:
  → 更新 state.json: status = "stopped"
  │
  ▼
前端 useStepProgress 收到 stopped 事件:
  → setIsStopped(true), setIsComplete(true)
  → UI 切换为"已停止"状态，显示重新开始按钮
```

### 3.2 层级职责

| 层级 | 职责 | 文件 |
|------|------|------|
| **前端 UI** | 显示停止按钮、状态变化、实时进度 | `apps/web/app/projects/[id]/page.tsx` |
| **前端 Hook** | 调用 stop API、管理 loading/error 状态 | `apps/web/hooks/useStepControl.ts` |
| **前端 SSE Hook** | 消费进度流，处理 stopped/complete 事件 | `apps/web/hooks/useStepProgress.ts` |
| **API Route** | 转发 stop 请求到服务、更新 state.json | `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` |
| **服务层 (Python)** | 管理 Job 生命周期：stop | `services/shared/job_manager.py` |
| **Job Handler** | 检查停止标志（check_stop） | `services/*/job_handler.py` |

---

## 4. 后端实现（Python 服务层）

### 4.1 JobStatus 枚举

```python
class JobStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"   # 对应前端的 "stopped"
```

### 4.2 JobRecord 停止机制

**文件**：`services/shared/job_manager.py`

```python
class JobRecord:
    def __init__(self, job_id: str, project_id: str):
        # ...
        self._stop_requested: bool = False

    def check_stop(self):
        """Job handlers 在每个工作单元之间调用。
        若 stop 已被请求，抛出 CancelledError 终止协程。"""
        if self._stop_requested:
            raise asyncio.CancelledError("Stop requested")

    def request_stop(self):
        self._stop_requested = True
        self._touch()
```

### 4.3 JobManager.stop()

```python
async def stop(self, job_id: str):
    job = self.get(job_id)
    job.request_stop()
    if job._task and not job._task.done():
        job._task.cancel()
    job.status = JobStatus.CANCELLED
    job._touch()
    # 广播 stopped 事件，前端 SSE 消费后关闭连接
    await job._broadcast("stopped", {
        "message": "Job stopped by user",
        "done": job.done,
        "total": job.total,
    })
```

### 4.4 Job Handler 中的检查点

每个服务的 `job_handler.py` 在循环体中调用 `check_stop()`：

```python
async def run_generate_images_job(job, project_id, config, provider):
    for shot in shots:
        job.check_stop()           # ← 检查停止请求
        if output_path.exists():
            job.done += 1
            await job.emit_progress(shot_id=shot_id, skipped=True, ...)
            continue
        await provider.generate_shot(...)
        job.done += 1
        await job.emit_progress(shot_id=shot_id, ...)
    await job.emit_complete({...})
```

**各服务检查点位置：**

| 服务 | 文件 | 检查点位置 |
|------|------|-----------|
| storyboard | `services/storyboard/job_handler.py` | LLM 调用前 |
| image | `services/image/job_handler.py` | 每个 shot 生成前 |
| tts | `services/tts/job_handler.py` | 每个 track 生成前 |
| video | `services/video/job_handler.py` | 每个 clip 生成前 |
| assembly | `services/assembly/job_handler.py` | 每个阶段前 |

### 4.5 FastAPI 路由

每个服务的 `main.py` 提供 stop 路由：

```python
@app.post("/jobs/{job_id}/stop", status_code=200)
async def stop_job(job_id: str):
    await job_manager.stop(job_id)
    return {"job_id": job_id, "status": "stopped"}
```

### 4.6 SSE 事件类型

| 事件名 | 触发时机 | 数据 |
|--------|---------|------|
| `progress` | 每个工作单元完成 | `{done, total, shot_id, message, skipped?, ...}` |
| `complete` | 全部完成 | `{result}` |
| `error` | 出错 | `{message, retryable}` |
| `stopped` | 用户点击停止 | `{message, done, total}` |

---

## 5. 前端实现（Next.js）

### 5.1 StepStatus 类型

**文件**：`apps/web/lib/project-store.ts`

```typescript
export type StepStatus = "pending" | "in_progress" | "stopped" | "completed" | "failed";
```

### 5.2 useStepControl Hook

**文件**：`apps/web/hooks/useStepControl.ts`

```typescript
export function useStepControl(projectId: string, mutateState: () => Promise<void>) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function callControl(step: StepName, action: "stop") {
    setLoadingFor(step, true);
    clearError(step);
    try {
      const res = await fetch(`/api/pipeline/${projectId}/${step}/${action}`, { method: "POST" });
      if (!res.ok) {
        setErrorFor(step, /* 解析错误 */);
        await mutateState();
        return;
      }
      await mutateState();
    } finally {
      setLoadingFor(step, false);
    }
  }

  const stopStep = useCallback((step: StepName) => callControl(step, "stop"), [...]);

  return { stopStep, loading, errors };
}
```

### 5.3 API Route

**文件**：`apps/web/app/api/pipeline/[id]/[step]/stop/route.ts`

逻辑：
1. 读取 `state.json` 取 `job_id`
2. 若无 `job_id`，直接将步骤状态置为 `stopped` 返回（幂等）
3. 调用 `{serviceUrl}/jobs/{job_id}/stop`
4. 收到 404（服务重启后 Job 已丢失）→ 视为停止成功，更新 `state.json`
5. 更新 `state.json: status = "stopped"`

### 5.4 useStepProgress SSE Hook

**文件**：`apps/web/hooks/useStepProgress.ts`

```typescript
export interface StepProgress {
  events: ProgressEvent[];
  lastEvent: ProgressEvent | null;
  isComplete: boolean;
  isStopped: boolean;   // stopped 事件触发时为 true
  error: string | null;
  percent: number;
  artifacts: ProgressArtifact[];
}
```

关键行为：
- 收到 `stopped` 事件：`setIsStopped(true)`, `setIsComplete(true)`, `es.close()`
- 收到 `complete` 事件：`setIsComplete(true)`, `es.close()`
- 步骤变为 active（`active = true`）时重置所有状态，确保 stop → restart 后可重新建立 SSE 连接

### 5.5 UI 操作区

**文件**：`apps/web/app/projects/[id]/page.tsx`（`StepCard` 内联组件）

| 状态 | 显示 |
|------|------|
| pending / stopped / failed | `[开始执行]` / `[重新开始]` / `[重试]` 按钮 |
| in_progress | `[■ 停止]` 按钮 |
| completed | `[删除全部]`（重置产物） + `[确认并继续 →]`（非自动模式） |

---

## 6. 断点续传机制

### 6.1 核心原则

停止后重新 start，**各服务自动跳过已存在文件**，无需额外实现状态持久化。

### 6.2 各服务跳过逻辑

| 服务 | 断点判断依据 | 跳过行为 |
|------|------------|---------|
| storyboard | `storyboard.json` 是否存在 | 已存在则读取直接返回 |
| image | `images/{shot_id}.png` 是否存在且非空 | 存在则跳过，emit_progress(skipped=True) |
| tts | `audio/{shot_id}_action.mp3` 是否存在 | 存在则跳过，emit_progress(skipped=True) |
| video | `clips/{shot_id}.mp4` 是否存在且非空 | 存在则跳过，emit_progress(skipped=True) |
| assembly | 无（幂等，每次全量重新合并）| 无断点，但操作幂等 |

> **原子写入保障**：各服务使用 `tmp → rename` 原子写入，停止时不会产生半写文件。

### 6.3 停止后重新开始流程

```
用户点击"重新开始"（stopped 状态）
    │
    ▼
POST /api/pipeline/{id}/{step}/start
    │
    ▼
服务层创建新 JobRecord（新 job_id）
    │
    ▼
Job handler 遍历 shots
    ├── 文件已存在 → check_stop() → emit_progress(skipped=True) → 跳过
    └── 文件不存在 → check_stop() → 正常生成 → emit_progress(done=N)
    │
    ▼
emit_complete()
```

---

## 7. 状态验证与自动修正

### 7.1 validateStepStatuses()

**文件**：`apps/web/lib/project-store.ts`

每次读取 `state.json` 时自动执行，对比实际磁盘文件数与分镜数，纠正不一致的状态：

| 场景 | 判断依据 | 修正结果 |
|------|---------|---------|
| state 显示 completed，但磁盘文件数 < 分镜数 | 文件数不足 | → `stopped` |
| state 显示 stopped，但磁盘无文件 | 无产物文件 | → `pending` |
| state 显示 pending，但磁盘已有文件 | 文件已存在 | → `stopped` |
| in_progress | 不干预（有活跃 Job） | 保持不变 |

**video 步骤特殊处理**：以图片数为基准（而非分镜数），因为 video 允许增量生成。

### 7.2 触发时机

`validateStepStatuses()` 在以下情况自动执行：
- 前端 SWR 轮询（每 5 秒）
- 任意 API 路由调用 `readState()`

---

## 8. 边界情况处理

### 8.1 服务重启后 Job 丢失

**场景**：服务容器重启后，内存中的 JobRecord 消失，但 `state.json` 中 `job_id` 仍然存在。

**处理**：
- stop API 路由收到服务返回 404 → 视为停止成功，直接更新 `state.json: status = stopped`
- `validateStepStatuses()` 在下次读取时根据文件数自动修正状态

### 8.2 快速多次点击停止

**处理**：`useStepControl` 在 loading 状态时 UI 按钮禁用，避免重复请求。

### 8.3 停止时文件完整性

`stopped` 事件后，当前 shot 正在写入的文件可能未完成。由于各服务使用原子写入（`tmp → rename`），停止只会留下已完整写入的文件，不会产生半写文件。

---

## 9. asyncio.Task 生命周期

```
1. JobManager.submit(project_id, coro) → 创建 JobRecord，生成 job_id
2. asyncio.create_task(_run()) → 后台任务启动
3. _run():
   a. job.status = IN_PROGRESS
   b. await coro(job)         ← 调用 job_handler 业务协程
   c. 正常完成: emit_complete()
   d. CancelledError: status = CANCELLED, broadcast("__done__", {})
   e. Exception: status = FAILED, emit_error()
4. 用户调用 stop():
   a. job.request_stop()      → _stop_requested = True
   b. job._task.cancel()      → 触发 CancelledError
   c. job.status = CANCELLED
   d. broadcast("stopped", {done, total})
   e. 注意：c/d 在 b 之前执行，确保 SSE 在 task cancel 前就发出
```

---

## 10. 已实现清单

### 10.1 后端（Python）

| 文件 | 内容 |
|------|------|
| `services/shared/job_manager.py` | `JobStatus`（无 paused）、`check_stop()`、`request_stop()`、`stop()`、SSE `stopped` 事件 |
| `services/*/main.py` | `POST /jobs/{id}/stop` 路由 |
| `services/*/job_handler.py` | `job.check_stop()` 检查点 |

### 10.2 前端（Next.js）

| 文件 | 内容 |
|------|------|
| `apps/web/lib/project-store.ts` | `StepStatus` 类型（含 `stopped`）、`validateStepStatuses()` |
| `apps/web/hooks/useStepControl.ts` | `stopStep`、loading/error 状态管理 |
| `apps/web/hooks/useStepProgress.ts` | `isStopped`、`stopped` 事件处理、active 时重置状态 |
| `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` | stop API Route（404 视为成功）|
| `apps/web/app/projects/[id]/page.tsx` | `StepCard` 停止按钮、stopped 状态 UI |

---

## 文档更新记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2026-04-20 | v1.0 | 初始版本，设计包含 pause/resume/stop | Sisyphus |
| 2026-04-21 | v2.0 | **完全重写**：以代码实际实现为准，去除 pause/resume（设计决策：stop+断点续传即可满足需求），补充 validateStepStatuses 等实际机制 | Claude Sonnet 4.6 |
