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

### 3.4 GPU 资源协调（Next.js 编排器职责）

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

## 6. 文件 I/O 约定

所有服务读写路径均基于 `PROJECT_DIR = /app/projects/{project_id}/`：

| 服务 | 读 | 写 |
|------|----|----|
| storyboard | input.txt | storyboard.json |
| image | storyboard.json | images/E01_NNN.png |
| tts | storyboard.json | audio/E01_NNN_action.wav, audio/E01_NNN_dialogue.wav |
| video | storyboard.json, audio/ | clips/E01_NNN.mp4 |
| assembly | storyboard.json, images/, audio/, clips/ | output/final.mp4, output/final.srt |
