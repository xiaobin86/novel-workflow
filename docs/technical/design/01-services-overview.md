# 01 — 服务层整体设计

整体架构图见：`diagrams/services-architecture.excalidraw`

---

## 1. 通用服务规范

所有 5 个服务遵循相同的接口规范和内部结构约定。

### 1.1 目录结构（每个服务）

```
services/{name}/
├── Dockerfile
├── requirements.txt
├── main.py              ← FastAPI 入口，路由定义
├── job_manager.py       ← Job 生命周期管理（通用）
├── model_manager.py     ← 模型加载/卸载（GPU 服务专用）
└── providers/
    ├── __init__.py      ← get_provider() 工厂函数
    ├── base.py          ← 抽象基类（Provider 接口）
    └── {impl}.py        ← 具体实现（local / cloud）
```

### 1.2 API 端点规范（所有服务统一）

```
POST   /jobs                    提交异步任务，立即返回 job_id
GET    /jobs/{job_id}/events    SSE 流，实时推送进度
GET    /jobs/{job_id}/status    查询当前状态
DELETE /jobs/{job_id}           取消任务
GET    /health                  健康检查

# GPU 服务额外提供：
GET    /model/status            查询模型加载状态
POST   /model/unload            强制卸载模型（编排器调用）
```

### 1.3 SSE 事件格式

```
event: progress
data: {"shot_id":"E01_001","done":1,"total":10,"message":"Generating image..."}

event: progress
data: {"shot_id":"E01_002","done":2,"total":10,"message":"Generating image..."}

event: complete
data: {"result":{"images":[{"shot_id":"E01_001","filename":"E01_001.png"}]}}

event: error
data: {"shot_id":"E01_003","message":"CUDA out of memory","retryable":true}
```

### 1.4 断点续传（通用规则）

每个 shot 处理前，检查目标文件是否已存在（文件存在且大小 > 0 字节）：
- **存在** → 跳过，直接发送 progress 事件（标记为已完成）
- **不存在** → 正常生成

---

## 2. Job 管理器（job_manager.py）

所有服务共用同一套 Job 生命周期管理逻辑。

### 2.1 Job 状态机

```
queued → in_progress → completed
                    ↘ failed
queued → cancelled
```

### 2.2 内存结构

```python
jobs: dict[str, JobRecord] = {}

class JobRecord:
    job_id: str
    status: Literal["queued", "in_progress", "completed", "failed", "cancelled"]
    done: int
    total: int
    result: dict | None
    error: str | None
    created_at: datetime
    task: asyncio.Task | None        # 后台协程引用，用于取消
    event_queue: asyncio.Queue       # SSE 事件缓冲
```

### 2.3 SSE 流处理

```python
@app.get("/jobs/{job_id}/events")
async def stream_events(job_id: str):
    async def generator():
        while True:
            event = await job.event_queue.get()
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
            if event["type"] in ("complete", "error"):
                break
    return StreamingResponse(generator(), media_type="text/event-stream")
```

### 2.4 JobManager 设计思路（伪代码）

```python
class JobManager:
    jobs: dict[str, JobRecord] = {}
    
    async def submit(self, job_type: str, payload: dict) -> str:
        """提交新 Job，立即返回 job_id"""
        job_id = generate_uuid()
        job = JobRecord(job_id=job_id, status="queued")
        self.jobs[job_id] = job
        
        # 启动后台 Task 执行实际工作
        job.task = asyncio.create_task(
            self._run_job(job, job_type, payload)
        )
        return job_id
    
    async def _run_job(self, job: JobRecord, job_type: str, payload: dict):
        """Job 执行主循环"""
        try:
            job.status = "in_progress"
            
            # 调用具体服务的业务逻辑
            # 业务逻辑通过回调/依赖注入传入，保持 JobManager 通用
            await self.job_handlers[job_type](job, payload)
            
            job.status = "completed"
            await job.emit_complete(job.result)
            
        except asyncio.CancelledError:
            job.status = "cancelled"
            await job.emit_error("Job cancelled", retryable=False)
            raise
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            await job.emit_error(str(e), retryable=True)
    
    async def cancel(self, job_id: str):
        """取消 Job"""
        job = self.jobs.get(job_id)
        if job and job.task:
            job.task.cancel()
            job.status = "cancelled"
    
    def get_status(self, job_id: str) -> dict:
        """查询 Job 状态"""
        job = self.jobs.get(job_id)
        return {
            "job_id": job_id,
            "status": job.status,
            "done": job.done,
            "total": job.total,
            "result": job.result,
            "error": job.error,
        }

# JobRecord 辅助方法
class JobRecord:
    async def emit_progress(self, shot_id: str, done: int, total: int, **kwargs):
        """推送进度事件到 SSE 队列"""
        event = {
            "type": "progress",
            "shot_id": shot_id,
            "done": done,
            "total": total,
            **kwargs,
        }
        await self.event_queue.put(event)
    
    async def emit_complete(self, result: dict):
        """推送完成事件"""
        await self.event_queue.put({"type": "complete", "result": result})
    
    async def emit_error(self, shot_id: str, message: str, retryable: bool):
        """推送错误事件"""
        await self.event_queue.put({
            "type": "error",
            "shot_id": shot_id,
            "message": message,
            "retryable": retryable,
        })
```

**设计要点：**
1. **JobManager 是通用模板**，所有 5 个服务共用同一套 `JobManager` 类
2. **业务逻辑解耦**：具体服务的处理逻辑通过 `job_handlers` 注册，JobManager 只负责生命周期管理
3. **内存管理**：已完成的 Job 保留在内存中（用于查询），但可设置 TTL（如 24 小时后清理）
4. **取消机制**：通过 `asyncio.Task.cancel()` 实现，业务逻辑需处理 `CancelledError`
5. **SSE 队列**：使用 `asyncio.Queue` 作为事件缓冲，消费者（SSE 流）和生产者（Job 执行）解耦

---

## 3. 模型生命周期管理（GPU 服务专用）

仅 image-service 和 video-service 需要此模块。

### 3.1 状态机

```
UNLOADED ──(请求到达)──▶ LOADING ──(加载完成)──▶ LOADED
                                                    │
                         ◀──(force_unload 或 TTL)──┘
UNLOADING ──(卸载完成)──▶ UNLOADED
```

### 3.2 ModelManager 设计

```python
class ModelManager:
    state: Literal["unloaded", "loading", "loaded", "unloading"]
    model: Any | None
    last_used_at: float | None
    ttl_seconds: int = 600           # 10 分钟空闲后自动卸载
    _lock: asyncio.Lock              # 防止并发加载/卸载

    async def get(self) -> Any:
        """获取模型（按需加载，更新 last_used_at）"""
        async with self._lock:
            if self.state == "unloaded":
                await self._load()
            self.last_used_at = time.time()
            return self.model

    async def force_unload(self):
        """强制卸载，由编排器在切换 GPU 服务前调用"""
        async with self._lock:
            if self.state == "loaded":
                await self._unload()

    async def _ttl_watchdog(self):
        """后台任务，每 60s 检查一次是否超过 TTL"""
        while True:
            await asyncio.sleep(60)
            if (self.state == "loaded"
                    and time.time() - self.last_used_at > self.ttl_seconds):
                async with self._lock:
                    await self._unload()
```

### 3.3 三个请求串行到来时的行为

```
时间线：

t=0    请求1 到达  → state=UNLOADED → 触发 _load()（阻塞，~2min）
t=120  _load() 完成 → state=LOADED，last_used_at 更新
       请求1 开始推理（~90s/shot）

t=210  请求2 到达（请求1 推理中）
       → get() 等待 _lock（请求1 持有锁做推理）
       → 请求1 推理完成释放锁
       → state=LOADED，last_used_at 更新，直接返回模型
       请求2 开始推理（无需重新加载，0s overhead）

t=310  请求3 到达，同上，直接使用已加载模型

t=370  请求3 完成，last_used_at 更新
       TTL watchdog 运行：600s 内无新请求 → 自动卸载
```

**结论：一批镜头（10 shots）只加载一次模型，整批完成后 10 分钟自动释放 VRAM。**

### 3.4 ModelManager 针对 video-service 的调整

由于 video-service 采用 **subprocess 方式** 调用 Wan（见 `05-service-video.md` 第 10 节），`model_manager.py` 需要调整：

```python
class VideoModelManager(ModelManager):
    """video-service 专用：管理 subprocess 进程锁"""
    
    _subprocess_lock: asyncio.Semaphore = asyncio.Semaphore(1)
    _current_proc: asyncio.subprocess.Process | None = None
    
    async def get(self):
        """
        不加载模型，只获取进程锁。
        返回锁对象，确保只有一个 subprocess 在运行。
        """
        await self._subprocess_lock.acquire()
        return self._subprocess_lock
    
    async def force_unload(self):
        """
        强制终止当前运行的 subprocess（如有）。
        由编排器在切换 GPU 服务前调用。
        """
        if self._current_proc and self._current_proc.returncode is None:
            self._current_proc.kill()
            await self._current_proc.wait()
        if self._subprocess_lock.locked():
            self._subprocess_lock.release()
    
    async def run_subprocess(self, cmd, timeout=600):
        """
        在持有锁的状态下运行 subprocess。
        调用方需要先 await self.get() 获取锁。
        """
        self._current_proc = await asyncio.create_subprocess_exec(*cmd, ...)
        try:
            stdout, stderr = await asyncio.wait_for(
                self._current_proc.communicate(), timeout=timeout
            )
            return self._current_proc.returncode, stdout, stderr
        finally:
            self._current_proc = None
            if self._subprocess_lock.locked():
                self._subprocess_lock.release()
```

**关键差异：**
| 方面 | image-service (Direct Import) | video-service (Subprocess) |
|------|------------------------------|---------------------------|
| 模型加载 | 服务进程内加载 FLUX pipeline | 不加载，由 subprocess 自己管理 |
| VRAM 释放 | `torch.cuda.empty_cache()` | subprocess 进程退出即释放 |
| 并发控制 | `_lock` 防止同时加载/推理 | `_subprocess_lock` 防止同时运行 generate.py |
| `/model/status` | `unloaded/loading/loaded` | `ready/busy`（表示是否有 subprocess 在运行）|
| `/model/unload` | 卸载模型 | kill 当前 subprocess |

---

### 3.5 GPU 资源协调（Next.js 编排器职责）

image-service 和 video-service 共享同一张 GPU（12GB VRAM），不得同时处于 LOADED 状态。

**编排顺序（Next.js API Route 执行）：**
```
Step 2 image: POST image-service/jobs → 等待完成
              POST image-service/model/unload   ← 切换前强制卸载
Step 3 tts:   POST tts-service/jobs → 等待完成  （CPU，无冲突）
Step 4 video: POST video-service/jobs → 等待完成
              POST video-service/model/unload   ← 完成后卸载
Step 5 asm:   POST assembly-service/jobs → 等待完成
```

---

## 4. Provider 抽象层

所有 AI 能力通过 Provider 接口隔离，便于未来替换云端实现。

### 4.1 设计原则

- 每个服务定义自己的 Provider 抽象基类（ABC）
- 具体实现放在 `providers/{name}.py`
- 通过环境变量 `{SERVICE}_PROVIDER` 选择实现
- 云端 Provider 预留接口但 v1.0 不实现

### 4.2 Provider 选择工厂

```python
# providers/__init__.py
def get_provider() -> XxxProvider:
    name = os.getenv("IMAGE_PROVIDER", "flux_local")
    match name:
        case "flux_local":   return FluxLocalProvider()
        case "replicate":    return ReplicateProvider()   # v2.0
        case "fal":          return FalProvider()         # v2.0
        case _:              raise ValueError(f"Unknown provider: {name}")
```

---

## 5. 服务启动顺序与健康检查

Docker Compose 启动时，Next.js 依赖所有服务健康才接受请求。

```yaml
# docker-compose.yml 中各服务的 healthcheck
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 10s
  timeout: 5s
  retries: 5
```

GPU 服务（image、video）启动时**不**预加载模型（按需加载），因此 `/health` 不等待模型就绪，只验证 FastAPI 进程正常。

---

## 7. Docker 进程守护与稳定性保障

### 7.1 为什么需要进程守护

本项目的服务均为 Python FastAPI 进程，运行环境存在多种不稳定因素：

| 风险场景 | 后果 | 触发条件 |
|----------|------|----------|
| **CUDA Segfault** | 容器直接崩溃退出 | GPU OOM、驱动异常、模型权重损坏 |
| **Python 未捕获异常** | 主事件循环终止 | Provider 逻辑 bug、文件 I/O 错误 |
| **内存泄漏** | 容器被 OOM Killed | 长时间运行、模型未卸载、内存碎片 |
| **模型加载卡住** | 服务假死，无响应 | 磁盘 IO 瓶颈、模型文件损坏 |
| **子进程残留** | 僵尸进程，资源泄漏 | video-service subprocess 异常退出 |

### 7.2 多层守护策略

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Docker 容器级（docker-compose）                    │
│  - restart: unless-stopped                                  │
│  - 容器崩溃后由 Docker daemon 自动重启                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Python 进程级（uvicorn + FastAPI）                 │
│  - --workers 1（单进程，避免多进程共享 GPU 冲突）             │
│  - 全局异常捕获 middleware，防止未处理异常终止进程            │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 业务逻辑级（JobManager + ModelManager）            │
│  - 单 Job 异常不终止服务（try/except 包裹）                   │
│  - 模型加载超时保护（防止假死）                               │
│  - subprocess 超时 + kill（video-service 专用）              │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 健康检查级（/health + Docker healthcheck）         │
│  - 定期探测服务可用性                                         │
│  - 连续失败则 Docker 标记 unhealthy 并重启                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: 资源限制级（Docker --memory --cpus）               │
│  - 限制容器内存上限，防止影响宿主机                           │
│  - GPU 服务限制共享内存（--shm-size）                        │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Docker Compose 配置示例

```yaml
services:
  image-service:
    build: ./services/image
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 16G          # 防止内存泄漏影响宿主机
        reservations:
          memory: 8G
    shm_size: '8gb'            # PyTorch 需要共享内存用于 IPC
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s        # 给模型加载预留时间
    environment:
      - PYTHONUNBUFFERED=1     # 确保日志实时输出
    logging:
      driver: "json-file"
      options:
        max-size: "100m"       # 日志轮转，防止占满磁盘
        max-file: "3"
```

### 7.4 Python 进程内的异常防护

```python
# main.py — 全局异常捕获 middleware
@app.middleware("http")
async def catch_all_exceptions(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"}
        )

# job_manager.py — Job 执行异常隔离
async def _run_job(self, job, ...):
    try:
        job.status = "in_progress"
        await job_handler(job, payload)
        job.status = "completed"
    except asyncio.CancelledError:
        raise  # 必须重新抛出，让 asyncio 正确处理取消
    except Exception as e:
        logger.error(f"Job {job.job_id} failed: {e}", exc_info=True)
        job.status = "failed"
        job.error = str(e)
        # 关键：不重新抛出，防止异常传播到主事件循环
```

### 7.5 优雅关闭（Graceful Shutdown）

```python
# main.py — 处理 SIGTERM/SIGINT
import signal

@app.on_event("shutdown")
async def shutdown_event():
    """Docker stop 时触发（SIGTERM）"""
    logger.info("Received shutdown signal, cleaning up...")
    
    # 1. 取消所有运行中的 Job
    for job in job_manager.jobs.values():
        if job.status == "in_progress":
            job.task.cancel()
    
    # 2. 卸载 GPU 模型（释放 VRAM）
    if hasattr(model_manager, "force_unload"):
        await model_manager.force_unload()
    
    # 3. 清理 subprocess（video-service）
    if hasattr(model_manager, "_current_proc"):
        proc = model_manager._current_proc
        if proc and proc.returncode is None:
            proc.kill()
    
    logger.info("Cleanup complete, exiting.")
```

### 7.6 日志与监控

| 日志类型 | 输出位置 | 用途 |
|----------|----------|------|
| 应用日志 | Docker stdout/stderr | 业务逻辑、错误追踪 |
| 访问日志 | uvicorn 默认 | HTTP 请求记录 |
| GPU 日志 | `nvidia-smi` 手动检查 | 显存、温度监控 |
| Job 日志 | SSE events | 实时进度追踪 |

**日志规范：**
- 所有服务使用统一格式：`[timestamp] [level] [service] message`
- 关键操作必须记录：`模型加载完成`、`Job 开始/完成/失败`、`文件写入路径`
- 敏感信息（API Key）禁止记录

### 7.7 故障恢复策略

| 故障类型 | 自动恢复 | 手动恢复 |
|----------|----------|----------|
| 容器崩溃 | Docker restart policy（最多 3 次/10分钟） | `docker compose restart <service>` |
| Job 失败 | 用户点击"重试"重新提交 | 删除产物文件，重置 state.json |
| 模型加载卡住 | healthcheck 超时 → 容器重启 | 检查模型文件完整性 |
| GPU 驱动错误 | 容器重启（可能恢复） | 重启宿主机 NVIDIA 服务 |
| 磁盘满 | 无自动恢复 | 清理旧项目文件 |

---

---

## 6. 文件 I/O 约定

所有服务读写路径均基于 `PROJECT_DIR = /app/projects/{project_id}/`：

| 服务 | 读 | 写 |
|------|----|----|
| storyboard | input.txt | storyboard.json |
| image | storyboard.json | images/E01_NNN.png |
| tts | storyboard.json | audio/E01_NNN_action.wav, audio/E01_NNN_dialogue.wav |
| video | storyboard.json, audio/ | clips/E01_NNN.mp4 |
| assembly | storyboard.json, images/, audio/, clips/ | output/final.mp4, output/final.srt |
