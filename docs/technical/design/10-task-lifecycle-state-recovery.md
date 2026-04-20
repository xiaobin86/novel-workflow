# 10 — 任务生命周期与状态恢复机制设计

> **文档编号**：10  
> **关联文档**：08-step-lifecycle-control.md（步骤生命周期控制）、01-services-overview.md（服务层设计）  
> **目标**：详细记录 asyncio.Task 的完整生命周期、停止/重启机制、state.json 的读取与验证逻辑  
> **核心关注点**：asyncio.Task 的创建 → 执行 → 暂停检查 → 取消/完成 的完整流程

---

## 1. 架构概览

整个系统的状态管理分为三个层次：

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Browser)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  UI 状态    │  │ SWR 轮询    │  │ SSE EventSource     │  │
│  │  React State│  │ 5s 间隔     │  │ 实时推送            │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  Next.js API Routes                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ state.json  │  │ Pipeline    │  │ SSE 代理            │  │
│  │ 读写        │  │ 编排 API    │  │ 透传                │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│              FastAPI 服务层 (Docker)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              JobManager (单例)                       │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │    │
│  │  │ _jobs    │  │ asyncio  │  │ asyncio.Queue    │   │    │
│  │  │ Dict     │  │ Lock     │  │ (SSE 广播)       │   │    │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │    │
│  │       │             │                 │             │    │
│  │       ▼             ▼                 ▼             │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │        JobRecord (每个任务一个实例)          │    │    │
│  │  │  ┌────────┐ ┌────────┐ ┌────────────────┐   │    │    │
│  │  │  │status  │ │_task   │ │_stop_requested │   │    │    │
│  │  │  │done    │ │(asyncio│ │(bool)          │   │    │    │
│  │  │  │total   │ │ Task)  │ │_pause_event    │   │    │    │
│  │  │  │result  │ │        │ │(asyncio.Event) │   │    │    │
│  │  │  └────────┘ └────────┘ └────────────────┘   │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │        Job Handler (业务协程)                        │    │
│  │  for shot in shots:                                 │    │
│  │      job.check_stop()      ← 取消检查点             │    │
│  │      if exists: continue   ← 断点续传               │    │
│  │      await generate()      ← 实际生成               │    │
│  │      await emit_progress() ← SSE 推送               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. asyncio.Task 完整生命周期

### 2.1 Task 创建流程

```
User 点击"开始执行"
    │
    ▼
POST /api/pipeline/{project_id}/{step}/start
    │
    ▼
Next.js API Route 读取 state.json
    │ 检查前置条件（前序步骤是否完成）
    ▼
向对应服务 POST /jobs
    │ Body: {project_id, config}
    ▼
┌──────────────────────────────────────────────────────────────┐
│                      FastAPI Service                         │
│                                                              │
│  @app.post("/jobs")                                          │
│  async def create_job(req: JobRequest):                     │
│      job = await job_manager.submit(                         │
│          project_id=req.project_id,                          │
│          coro=run_generate_images_job  ← 业务协程            │
│      )                                                       │
│      return {"job_id": job.job_id}                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│              JobManager.submit() — Task 创建                 │
│                                                              │
│  1. 生成 job_id (uuid.uuid4().hex[:12])                     │
│                                                              │
│  2. 创建 JobRecord 实例                                      │
│     ┌─────────────────────────────────────┐                  │
│     │ job = JobRecord(                    │                  │
│     │     job_id=job_id,                  │                  │
│     │     project_id=project_id,          │                  │
│     │     status=QUEUED,                  │                  │
│     │     _task=None,                     │                  │
│     │     _stop_requested=False,          │                  │
│     │     _queue=asyncio.Queue(),         │                  │
│     │     _subscribers=[]                 │                  │
│     │ )                                   │                  │
│     └─────────────────────────────────────┘                  │
│                                                              │
│  3. 定义包装协程 _run()                                      │
│     ┌─────────────────────────────────────┐                  │
│     │ async def _run():                   │                  │
│     │     job.status = IN_PROGRESS        │                  │
│     │     try:                            │                  │
│     │         await coro(job)  ← 执行业务 │                  │
│     │     except CancelledError:          │                  │
│     │         job.status = CANCELLED      │                  │
│     │         broadcast("__done__")       │                  │
│     │     except Exception as exc:        │                  │
│     │         job.status = FAILED         │                  │
│     │         emit_error(str(exc))        │                  │
│     │         broadcast("__done__")       │                  │
│     └─────────────────────────────────────┘                  │
│                                                              │
│  4. 创建 asyncio.Task                                        │
│     ┌─────────────────────────────────────┐                  │
│     │ job._task = asyncio.create_task(    │                  │
│     │     _run()                          │                  │
│     │ )                                   │                  │
│     │                                     │                  │
│     │ # 此时 _run 协程被调度到事件循环    │                  │
│     │ # 但不一定立即执行（取决于循环状态）│                  │
│     └─────────────────────────────────────┘                  │
│                                                              │
│  5. 返回 JobRecord（此时 status=QUEUED 或 IN_PROGRESS）      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
Next.js 更新 state.json
    │ {status: "in_progress", job_id: "xxx"}
    ▼
返回 200 OK {job_id, status: "in_progress"}
    │
    ▼
Browser 开始 SSE 连接
    GET /api/pipeline/{id}/{step}/events
```

### 2.2 Task 执行流程（以 image-service 为例）

```
asyncio.Task 开始执行 _run() 协程
    │
    ▼
_run() 设置 job.status = IN_PROGRESS
    │
    ▼
调用业务协程 run_generate_images_job(job, project_id, config, provider)
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│              Job Handler 执行循环（业务逻辑）                  │
│                                                              │
│  读取 storyboard.json → 获取 shots 列表                     │
│  job.total = len(shots)  ← 设置总工作量                     │
│                                                              │
│  for shot in shots:                                         │
│      │                                                       │
│      ├─► job.check_stop()                                   │
│      │    ┌─────────────────────────────────────┐           │
│      │    │ def check_stop(self):               │           │
│      │    │     if self._stop_requested:        │           │
│      │    │         raise CancelledError(       │           │
│      │    │             "Stop requested"        │           │
│      │    │         )                           │           │
│      │    └─────────────────────────────────────┘           │
│      │    # 如果用户点击了停止，这里抛出 CancelledError    │
│      │    # 被 _run() 的 except CancelledError 捕获       │
│      │                                                       │
│      ├─► 检查文件是否已存在（断点续传）                      │
│      │    output_path = images_dir / f"{shot_id}.png"      │
│      │    if output_path.exists() and size > 0:            │
│      │        job.done += 1                                │
│      │        emit_progress(skipped=True)                  │
│      │        continue  ← 跳过已存在的                     │
│      │                                                       │
│      ├─► 调用 Provider 生成（耗时操作）                      │
│      │    await provider.generate_shot(...)                │
│      │    # 此处会释放事件循环，允许其他协程运行            │
│      │    # 包括处理 HTTP 请求（如 /stop）                  │
│      │                                                       │
│      ├─► 更新进度                                          │
│      │    job.done += 1                                    │
│      │    await job.emit_progress(shot_id=..., done=...)   │
│      │    # 将消息放入所有 subscriber 的 Queue              │
│      │    # SSE 生成器从 Queue 取出并推送到浏览器           │
│      │                                                       │
│  loop end                                                   │
│                                                              │
│  await job.emit_complete({images: [...], total: N})         │
│  # 设置 status=COMPLETED，广播 complete 事件                │
│  # 广播 __done__ 事件，SSE 连接正常关闭                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Task 取消流程（用户点击停止）

```
User 点击"停止"
    │
    ▼
POST /api/pipeline/{project_id}/{step}/stop
    │
    ▼
Next.js 读取 state.json 获取 job_id
    │
    ▼
向服务 POST /jobs/{job_id}/stop
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│              JobManager.stop() — Task 取消                   │
│                                                              │
│  1. 获取 JobRecord                                          │
│     job = self.get(job_id)                                  │
│                                                              │
│  2. 设置停止标志                                            │
│     job.request_stop()                                      │
│     # _stop_requested = True                                │
│                                                              │
│  3. 取消 asyncio.Task                                       │
│     ┌─────────────────────────────────────┐                 │
│     │ if job._task and not job._task.done()│                 │
│     │     job._task.cancel()              │                 │
│     │                                     │                 │
│     │ # cancel() 在 Task 中注入           │                 │
│     │ # CancelledError 异常               │                 │
│     │ # 但 Task 不会立即停止！            │                 │
│     └─────────────────────────────────────┘                 │
│                                                              │
│  4. 更新状态                                                │
│     job.status = CANCELLED                                  │
│                                                              │
│  5. 广播 stopped 事件                                       │
│     await job._broadcast("stopped", {                       │
│         "message": "Job stopped",                           │
│         "done": job.done,                                   │
│         "total": job.total                                  │
│     })                                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
Task 的取消传播（两种场景）

场景 A：Task 正在 await（如 generate_shot）
    │
    ▼
await provider.generate_shot(...) 被中断
    │ CancelledError 立即抛出
    ▼
业务协程中如果没有捕获 CancelledError
    │ 异常向上传播
    ▼
被 _run() 的 except CancelledError 捕获
    │
    ▼
job.status = CANCELLED
broadcast("__done__")
Task 结束

场景 B：Task 正在执行同步代码（check_stop 之前）
    │
    ▼
cancel() 不会立即停止 Task！
    │ CancelledError 只在下一个 await 点注入
    ▼
Task 继续执行直到下一个 await
    │ 可能是 check_stop()、emit_progress() 等
    ▼
在 check_stop() 中：
    │ if _stop_requested: raise CancelledError
    ▼
被 _run() 的 except CancelledError 捕获
    │
    ▼
job.status = CANCELLED
broadcast("__done__")
Task 结束

关键说明：
- cancel() 是协作式取消，不是强制终止
- Task 必须遇到 await 点才能响应取消
- 因此 job.check_stop() 检查点是必需的
- 没有检查点的话，Task 可能长时间不响应取消

### 2.3a 关键细节：shot 级原子操作与取消时机

> ⚠️ **重要**：`asyncio.Task.cancel()` 以**单个 shot 的生成**为原子操作单位。

```
用户点击停止
    │
    ▼
JobHandler 正在执行：
    for shot in shots:
        check_stop()          ← 通过，未设置停止标志
        await generate_shot()  ← 开始生成当前 shot
        ^
        │
    此时用户点击停止 ──────────┘
        │
        ▼
    task.cancel() 发送 CancelledError
        │
        ▼
    但 generate_shot() 不会立即中断！
        │
        ▼
    Provider 继续完成当前 shot 的推理和保存
        │
        ▼
    generate_shot() 返回后
        │
        ▼
    下一个 await 点（emit_progress 或 check_stop）
        │
        ▼
    CancelledError 才被抛出
        │
        ▼
    任务终止
```

**实际影响**：

| 场景 | 行为 | 结果 |
|------|------|------|
| 取消发生在 `check_stop()` 之后、`generate_shot()` 之前 | 正常取消，不生成新 shot | 无额外文件 |
| 取消发生在 `generate_shot()` 执行期间 | 当前 shot **仍会完成生成**并保存到磁盘 | 可能比预期多 1 个文件 |
| 取消发生在 `emit_progress()` 期间 | 进度推送完成后取消 | 无额外文件 |

**设计决策**：
- 接受这种"多生成 1 张"的行为，视为可接受的副作用
- 不强制在 Provider 内部插入额外的取消检查点（避免过度复杂化 Provider 实现）
- 断点续传的文件存在性检查会自然跳过已生成的文件，因此重新开始时不受影响
- 状态验证逻辑（`validateStepStatuses`）也基于此假设：实际文件数可能 ≥ 取消时预期的文件数

**代码体现**（`services/image/job_handler.py` 伪代码）：

```python
for shot in shots:
    job.check_stop()  # ← 取消检查点 1：这里响应取消
    
    # 如果取消信号在 check_stop() 之后到达：
    await provider.generate_shot(shot)  # ← 原子操作，期间不响应取消
    
    # generate_shot 完成后，到下一个 await 点才处理取消：
    job.done += 1
    await job.emit_progress(...)  # ← 取消检查点 2：这里也可能响应取消
```
```

### 2.4 asyncio.Task 状态转换图

```
                           ┌─────────────┐
                           │   PENDING   │  ← create_task() 创建
                           │  (初始状态) │     但尚未开始执行
                           └──────┬──────┘
                                  │
                                  │ 事件循环调度
                                  ▼
                           ┌─────────────┐
      ┌───────────────────│   RUNNING   │  ← _run() 开始执行
      │    cancel()       │  (执行中)   │     业务逻辑运行中
      │                   └──────┬──────┘
      │                          │
      │         ┌────────────────┼────────────────┐
      │         │                │                │
      │         ▼                ▼                ▼
      │  ┌───────────┐   ┌───────────┐   ┌───────────┐
      │  │ 自然完成   │   │ 异常失败   │   │ 正常取消   │
      │  │ emit_     │   │ emit_     │   │ status=   │
      │  │ complete()│   │ error()   │   │ CANCELLED │
      │  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
      │        │               │               │
      │        ▼               ▼               ▼
      │   ┌────────┐      ┌────────┐      ┌────────┐
      └──▶│CANCELLED│      │ FAILED │      │COMPLETED│
         │(已取消) │      │(失败)  │      │(完成)  │
         └─────────┘      └────────┘      └────────┘
              │                              │
              ▼                              ▼
         broadcast("__done__")          broadcast("__done__")
              │                              │
              ▼                              ▼
         SSE 连接关闭                   SSE 连接关闭
```

---

## 3. 停止后重启机制

### 3.1 重启流程

```
User 点击"重新开始"
    │
    ▼
POST /api/pipeline/{project_id}/{step}/start
    │
    ▼
Next.js 不检查 state.json 中的旧 job_id
    │ 直接创建新任务
    ▼
向服务 POST /jobs（新 job）
    │
    ▼
JobManager.submit() 创建新的 JobRecord + Task
    │
    ▼
业务协程 run_generate_images_job() 开始执行
    │
    ├─► for shot in shots:
    │       check_stop()
    │       
    │       ┌─────────────────────────────────────┐
    │       │ 检查文件存在性（断点续传核心）      │
    │       │                                     │
    │       │ if output_path.exists():            │
    │       │     job.done += 1                   │
    │       │     emit_progress(skipped=True)     │
    │       │     continue  ← 关键！跳过已生成    │
    │       │                                     │
    │       │ # 无需额外状态记录                  │
    │       │ # 文件系统就是状态                  │
    │       └─────────────────────────────────────┘
    │       
    │       await provider.generate_shot(...)  ← 只生成缺失的
    │       emit_progress(skipped=False)
    │
    ▼
emit_complete()  ← 所有文件最终都会存在
```

### 3.2 断点续传的文件系统约定

| 步骤 | 文件路径模式 | 跳过条件 |
|------|-------------|---------|
| storyboard | `{project}/storyboard.json` | 文件存在且非空 |
| image | `{project}/images/{shot_id}.png` | 文件存在且 size > 0 |
| tts | `{project}/audio/{shot_id}_action.mp3` | 文件存在 |
| tts | `{project}/audio/{shot_id}_dialogue.mp3` | 文件存在 |
| video | `{project}/clips/{shot_id}.mp4` | 文件存在且 size > 0 |
| assembly | `{project}/output/final.mp4` | 无断点，每次都全量重算 |

---

## 4. state.json 读取与验证机制

### 4.1 三层读取策略

```
readState(project_id)
    │
    ├─► 尝试读取 {project}/state.json
    │     │
    │     ├─► 成功 → 进入验证流程
    │     │
    │     └─► 失败（ENOENT）→ 进入恢复流程
    │           │
    │           └─► recoverStateFromDisk()
    │                 扫描磁盘文件重建 state
    │                 返回重建后的 state
    │
    ▼
验证流程（state.json 存在时）
    │
    ├─► 清理旧格式字段
    │     删除 steps[].result（如果存在）
    │
    ├─► validateStepStatuses()  ← 核心验证
    │     │
    │     ├─► 读取 storyboard.json 获取 shot_count
    │     │
    │     ├─► 对每个步骤（image/tts/video）：
    │     │     │
    │     │     ├─► 如果 status == "pending"
    │     │     │     → 跳过（无文件期望）
    │     │     │
    │     │     ├─► 扫描磁盘获取实际文件数
    │     │     │     image: images/*.png 数量
    │     │     │     tts:  audio/*.mp3 去重 shot_id 数量
    │     │     │     video: clips/*.mp4 数量
    │     │     │
    │     │     ├─► 计算期望状态
    │     │     │     actual_count == 0          → "pending"
    │     │     │     actual_count >= shot_count → "completed"
    │     │     │     其他                        → "stopped"
    │     │     │
    │     │     └─► 如果 current_status != expected_status
    │     │           → 修正状态，清空 job_id
    │     │           → 标记 dirty=true
    │     │
    │     └─► 返回 dirty 标志
    │
    └─► 如果 dirty → 写回 state.json
    │
    ▼
返回 ProjectState
```

### 4.2 验证逻辑伪代码

```python
async def validateStepStatuses(project_id, state):
    shot_count = read_storyboard_shots_count()
    dirty = False
    
    for step in ["image", "tts", "video"]:
        current_status = state.steps[step].status
        
        if current_status == "pending":
            continue  # 无文件期望，无需验证
        
        # 从磁盘读取实际文件
        result = recoverStepResult(project_id, step)
        
        if not result:
            # 状态说已生成，但磁盘无文件
            state.steps[step].status = "pending"
            state.steps[step].job_id = None
            dirty = True
            continue
        
        # 计算实际文件数
        if step == "image":
            actual_count = len(result.data.images)
        elif step == "tts":
            unique_shots = set(f.replace(/_[^_]+\.[^.]+$/, "") 
                              for f in result.data.audio_files)
            actual_count = len(unique_shots)
        elif step == "video":
            actual_count = len(result.data.clips)
        
        # 确定期望状态
        if actual_count == 0:
            expected = "pending"
        elif actual_count >= shot_count:
            expected = "completed"
        else:
            expected = "stopped"
        
        # 状态不一致时修正
        if current_status != expected:
            state.steps[step].status = expected
            state.steps[step].job_id = None  # 清除失效的 job_id
            state.steps[step].updated_at = now()
            dirty = True
    
    return dirty
```

### 4.3 状态修正场景示例

```
场景 1：服务重启后 job 丢失
    │
    ├─► state.json: {status: "in_progress", job_id: "abc123"}
    ├─► 实际文件: images/ 目录有 13 个 PNG
    ├─► storyboard: 20 个 shots
    │
    ▼
验证结果:
    actual_count = 13 < shot_count = 20
    expected = "stopped"
    current = "in_progress"
    │
    ▼
修正:
    status → "stopped"
    job_id → null
    写回 state.json

场景 2：用户手动删除文件
    │
    ├─► state.json: {status: "completed"}
    ├─► 实际文件: images/ 目录为空（用户手动删除）
    ├─► storyboard: 20 个 shots
    │
    ▼
验证结果:
    actual_count = 0
    expected = "pending"
    current = "completed"
    │
    ▼
修正:
    status → "pending"
    写回 state.json

场景 3：所有文件生成完成
    │
    ├─► state.json: {status: "stopped"}
    ├─► 实际文件: images/ 目录有 20 个 PNG
    ├─► storyboard: 20 个 shots
    │
    ▼
验证结果:
    actual_count = 20 >= shot_count = 20
    expected = "completed"
    current = "stopped"
    │
    ▼
修正:
    status → "completed"
    写回 state.json
```

---

## 5. 列表读取与磁盘恢复

### 5.1 项目列表读取流程

```
GET /api/projects
    │
    ▼
listProjects()
    │
    ├─► 读取 PROJECTS_BASE_DIR 下的所有子目录
    │
    ├─► 对每个目录（project_id）：
    │     │
    │     ├─► readState(project_id)
    │     │     读取 state.json
    │     │     或从磁盘恢复
    │     │     （包含验证逻辑）
    │     │
    │     └─► 提取元数据
    │           {id, title, episode, created_at, steps}
    │
    ├─► 过滤无效项目
    │
    └─► 按 created_at 降序排序
    │
    ▼
返回 ProjectMeta[]
```

### 5.2 磁盘恢复（state.json 缺失时）

```
recoverStateFromDisk(project_id)
    │
    ├─► 检查项目目录是否存在
    │     不存在 → return null
    │
    ├─► 从 storyboard.json 读取元数据
    │     title, episode, shot_count
    │
    ├─► 初始化空步骤状态（全部为 pending）
    │
    ├─► 扫描每个步骤的磁盘文件
    │     │
    │     ├─► storyboard: storyboard.json 存在?
    │     │     → status = "completed"
    │     │
    │     ├─► image: images/*.png 数量?
    │     │     → 0: pending, <shot_count: stopped, >=: completed
    │     │
    │     ├─► tts: audio/*.mp3 去重 shot_id 数量?
    │     │     → 同上
    │     │
    │     ├─► video: clips/*.mp4 数量?
    │     │     → 同上
    │     │
    │     └─► assembly: output/final.mp4 存在?
    │           → status = "completed"
    │
    ├─► 构建 ProjectState
    │
    ├─► 写回 state.json（持久化）
    │
    ▼
返回 ProjectState
```

---

## 6. 时序图：完整生命周期

### 6.1 正常执行到完成

```
User   Browser  Next.js  image-svc  JobManager  JobHandler  FluxProvider
 │        │        │          │          │           │            │
 │ 点击   │        │          │          │           │            │
 │开始执行│        │          │          │           │            │
 │───────▶│        │          │          │           │            │
 │        │ POST /start       │          │           │            │
 │        │──────────────────▶│          │           │            │
 │        │        │ POST /jobs          │           │            │
 │        │        │────────────────────▶│           │            │
 │        │        │          │ submit()  │           │            │
 │        │        │          │──────────▶│           │            │
 │        │        │          │           │ create    │            │
 │        │        │          │           │ JobRecord │            │
 │        │        │          │           │───────────│            │
 │        │        │          │           │ create    │            │
 │        │        │          │           │ asyncio   │            │
 │        │        │          │           │ Task      │            │
 │        │        │          │           │───────────│            │
 │        │        │          │◀─────────│ return    │            │
 │        │        │◀─────────│          │ job_id    │            │
 │        │◀───────│          │          │           │            │
 │        │ SSE /events       │          │           │            │
 │        │──────────────────▶│          │           │            │
 │        │        │          │          │ Task 开始 │            │
 │        │        │          │          │ 执行      │            │
 │        │        │          │          │──────────▶│            │
 │        │        │          │          │           │ for shot   │
 │        │        │          │          │           │ in shots:  │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ check_stop │
 │        │        │          │          │           │ (pass)     │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ generate() │
 │        │        │          │          │           │───────────▶│
 │        │        │          │          │           │            │
 │        │        │          │          │           │◀───────────│
 │        │        │          │          │           │ (done)     │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ emit_      │
 │        │        │          │          │           │ progress() │
 │        │        │          │          │           │            │
 │        │◀───────│          │          │◀──────────│ SSE        │
 │        │ progress          │          │           │ broadcast  │
 │        │◀──────────────────│          │           │            │
 │        │        │          │          │           │ ...        │
 │        │        │          │          │           │ (loop)     │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ emit_      │
 │        │        │          │          │           │ complete() │
 │        │        │          │          │           │            │
 │        │◀───────│          │          │◀──────────│ SSE        │
 │        │ complete          │          │           │ broadcast  │
 │        │◀──────────────────│          │           │            │
 │        │        │          │          │           │ __done__   │
 │        │        │          │          │           │            │
 │        │ SSE 连接关闭      │          │           │            │
 │        │◀──────────────────│          │           │            │
 │        │        │          │          │           │            │
```

### 6.2 执行中停止

```
User   Browser  Next.js  image-svc  JobManager  JobHandler  FluxProvider
 │        │        │          │          │           │            │
 │ 点击   │        │          │          │           │            │
 │ 停止   │        │          │          │           │            │
 │───────▶│        │          │          │           │            │
 │        │ POST /stop        │          │           │            │
 │        │──────────────────▶│          │           │            │
 │        │        │ POST /jobs/{id}/stop│           │            │
 │        │        │────────────────────▶│           │            │
 │        │        │          │          │ stop()    │            │
 │        │        │          │          │──────────▶│            │
 │        │        │          │          │           │            │
 │        │        │          │          │ 1. request│            │
 │        │        │          │          │    _stop()│            │
 │        │        │          │          │           │            │
 │        │        │          │          │ 2. task.  │            │
 │        │        │          │          │    cancel()│           │
 │        │        │          │          │           │            │
 │        │        │          │          │ 3. status=│            │
 │        │        │          │          │    CANCELLED           │
 │        │        │          │          │           │            │
 │        │        │          │          │ 4. broadcast          │
 │        │        │          │          │    stopped│            │
 │        │        │          │          │           │            │
 │        │◀───────│          │          │◀──────────│            │
 │        │ stopped│          │          │           │            │
 │        │◀───────│          │          │           │            │
 │        │        │          │          │           │            │
 │        │        │          │          │ (JobHandler 当前状态) │
 │        │        │          │          │           │            │
 │        │        │          │          │ 场景 A：在 await      │
 │        │        │          │          │ generate() 中         │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ Cancelled  │
 │        │        │          │          │           │ Error 注入 │
 │        │        │          │          │           │◀───────────│
 │        │        │          │          │           │ (中断)     │
 │        │        │          │          │           │            │
 │        │        │          │          │ 场景 B：在同步代码中  │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ 继续执行   │
 │        │        │          │          │           │ 直到下一个 │
 │        │        │          │          │           │ await 点   │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ check_stop │
 │        │        │          │          │           │◀───────────│
 │        │        │          │          │           │ _stop_req  │
 │        │        │          │          │           │ = True     │
 │        │        │          │          │           │            │
 │        │        │          │          │           │ raise      │
 │        │        │          │          │           │ Cancelled  │
 │        │        │          │          │           │            │
 │        │        │          │          │ (两种情况汇聚)        │
 │        │        │          │          │           │            │
 │        │        │          │          │ except    │            │
 │        │        │          │          │ Cancelled │            │
 │        │        │          │          │ Error:    │            │
 │        │        │          │          │ status =  │            │
 │        │        │          │          │ CANCELLED │            │
 │        │        │          │          │ __done__  │            │
 │        │        │          │          │           │            │
 │        │        │          │          │ SSE 关闭  │            │
 │        │        │          │          │           │            │
```

---

## 7. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **取消机制** | asyncio.Task.cancel() + 协作式检查点 | Python 没有强制终止线程/Task 的安全方式，cancel() + check_stop() 是标准做法 |
| **状态真相源** | 文件系统 > state.json | state.json 可能因崩溃/重启而失效，文件系统是不可篡改的真相源 |
| **断点续传** | 文件存在性检查 | 无需额外状态记录，简单可靠，原子写入保证文件完整性 |
| **job_id 持久化** | state.json 存储 | 前端需要知道当前运行的 job_id 才能调用 /stop，但服务重启后失效 |
| **服务重启恢复** | 不实现跨进程恢复 | v1.0 范围限制，通过状态验证 + 断点续传实现等效效果 |
| **SSE 断线** | SWR 轮询 fallback | SSE 是实时推送的最佳方案，但断线后 SWR 轮询保证最终一致性 |

---

## 8. 代码清单

| 文件 | 职责 |
|------|------|
| `services/shared/job_manager.py` | JobManager + JobRecord，Task 生命周期管理 |
| `services/*/job_handler.py` | 业务协程，含 check_stop() 检查点 |
| `services/*/main.py` | FastAPI 路由，接收 /jobs /stop 请求 |
| `apps/web/lib/project-store.ts` | state.json 读写 + 验证逻辑 |
| `apps/web/hooks/useStepProgress.ts` | SSE 连接 + 实时进度状态 |
| `apps/web/hooks/useStepControl.ts` | stop/start 操作封装 |

---

*本文档由 Sisyphus Agent 创建*  
*创建时间：2026-04-20*  
*关联任务：状态验证逻辑设计与 asyncio.Task 流程文档化*
