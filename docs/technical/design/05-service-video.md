# 05 — video-service 详细设计

**职责**：将分镜 JSON 中每个 shot 的 video_prompt 生成视频片段 MP4  
**端口**：8004  
**GPU**：必须（Wan2.1-T2V-1.3B，约 16.6GB，需 32GB RAM 作为内存卸载缓冲）  
**外部依赖**：无（模型本地加载）  
**前置条件**：tts-service 已完成（需要 `audio_durations.json` 计算视频时长）

---

## 1. 内部架构

```
main.py (FastAPI)
│
├── POST /jobs               → job_manager.submit(GenerateClipsJob)
├── GET  /jobs/{id}/events   → job_manager.stream(job_id)
├── GET  /jobs/{id}/status   → job_manager.status(job_id)
├── GET  /model/status       → model_manager.status()
├── POST /model/unload       → model_manager.force_unload()
└── GET  /health

job_manager.py
model_manager.py            ← 管理 Wan pipeline 实例

providers/
├── base.py                 → VideoProvider (ABC)
├── wan_local.py            → WanLocalProvider (v1.0 实现)
└── __init__.py             → get_provider()
```

---

## 2. API 端点

### POST /jobs

**请求体：**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "config": {
    "width": 832,
    "height": 480,
    "num_frames": 65,
    "num_inference_steps": 30
  }
}
```

**响应（202）：**
```json
{
  "job_id": "vid_job_ghi012",
  "status": "queued"
}
```

### GET /jobs/{job_id}/events（SSE）

```
event: progress
data: {"shot_id":"E01_001","done":1,"total":10,"message":"Generated clip (6.8s)","skipped":false}

event: progress
data: {"shot_id":"E01_002","done":2,"total":10,"message":"Skipped (already exists)","skipped":true}

event: complete
data: {"result":{"clips":[{"shot_id":"E01_001","filename":"E01_001.mp4","duration":6.8}],"total":10}}
```

---

## 3. Provider 接口

### base.py

```python
from abc import ABC, abstractmethod

class VideoProvider(ABC):
    @abstractmethod
    async def generate_clip(
        self,
        shot_id: str,
        prompt: str,
        output_path: str,
        duration_seconds: float,
        config: dict,
    ) -> None:
        """
        生成视频片段。duration_seconds 决定输出视频的实际时长。
        若模型输出帧数不足，由 FFmpeg 冻结最后一帧补齐。
        """
        ...

    @abstractmethod
    async def load_model(self) -> None: ...

    @abstractmethod
    async def unload_model(self) -> None: ...
```

### WanLocalProvider（v1.0）

**模型加载策略（原格式，非 Diffusers 格式）：**

Wan2.1 有两种存储格式：
- **Diffusers 格式**（27GB）：标准 HuggingFace 格式，RAM 需求过高，在 32GB 机器上 OOM
- **原格式**（16.6GB）：官方仓库原始权重，RAM 友好 ✅ **使用此格式**

```python
import sys
sys.path.insert(0, "/app/models/Wan2.1-T2V-1.3B")  # 原格式需要官方推理代码
from wan.text2video import WanT2V

async def load_model(self):
    self.wan = WanT2V(
        config_path="/app/models/Wan2.1-T2V-1.3B/config.py",
        checkpoint_dir="/app/models/Wan2.1-T2V-1.3B/",
        device="cuda",
        dtype=torch.bfloat16,
    )
```

**单个视频片段生成（约 5 分钟/片段）：**

```python
ANIME_STYLE_PREFIX = (
    "Anime Chinese manhua style, cel-shaded, flat colors, "
    "2D animation, clean lineart. "
)

async def generate_clip(self, shot_id, prompt, output_path, duration_seconds, config):
    full_prompt = ANIME_STYLE_PREFIX + prompt
    num_frames = config.get("num_frames", 65)  # 65帧 ≈ 4秒（16fps）

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, self._sync_generate,
                               full_prompt, output_path, num_frames, config)

    # 若 TTS 时长超过模型默认时长，用 FFmpeg 冻结最后一帧补齐
    model_duration = num_frames / 16.0  # Wan 输出帧率约 16fps
    if duration_seconds > model_duration:
        await self._freeze_extend(output_path, duration_seconds)

def _sync_generate(self, prompt, output_path, num_frames, config):
    frames = self.wan.generate(
        prompt=prompt,
        size=(config.get("width", 832), config.get("height", 480)),
        num_frames=num_frames,
        num_inference_steps=config.get("num_inference_steps", 30),
    )
    save_video(frames, output_path, fps=16)

async def _freeze_extend(self, video_path, target_duration):
    """用 FFmpeg 冻结最后一帧来延长视频至 target_duration"""
    tmp = video_path + ".tmp.mp4"
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"tpad=stop_mode=clone:stop_duration={target_duration}",
        "-t", str(target_duration),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        tmp, "-y"
    ]
    await asyncio.create_subprocess_exec(*cmd)
    os.replace(tmp, video_path)
```

### 预留 Provider（v2.0 不实现）

```python
class ReplicateWanProvider(VideoProvider):
    """通过 Replicate API 调用 Wan，无需本地 GPU"""
    ...
```

---

## 4. 视频时长计算（核心逻辑）

这是整个管线最关键的设计之一，避免 TTS 旁白被截断：

```python
def calculate_clip_duration(shot: dict, audio_durations: dict) -> float:
    shot_id = shot["shot_id"]
    declared = shot.get("duration", 4.0)

    # 读取 TTS 实际时长
    durations = audio_durations.get(shot_id, {})
    action_dur = durations.get("action", 0.0)
    dialogue_dur = durations.get("dialogue", 0.0)
    tts_total = max(action_dur, dialogue_dur)   # 取较长轨道

    # 实际时长 = max(声明时长, TTS 时长 + 0.5s buffer)
    return max(declared, tts_total + 0.5) if tts_total > 0 else declared
```

---

## 5. 核心处理流程

```python
async def run_generate_clips_job(job, project_id, config):
    project_dir = Path(f"/app/projects/{project_id}")
    storyboard = json.loads((project_dir / "storyboard.json").read_text())
    audio_durations = json.loads((project_dir / "audio_durations.json").read_text())
    clips_dir = project_dir / "clips"
    clips_dir.mkdir(exist_ok=True)

    shots = storyboard["shots"]
    job.total = len(shots)
    provider = model_manager.get_provider()  # 按需加载 Wan 模型

    for shot in shots:
        shot_id = shot["shot_id"]
        output_path = clips_dir / f"{shot_id}.mp4"

        # 断点续传
        if output_path.exists() and output_path.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(shot_id, skipped=True)
            continue

        duration = calculate_clip_duration(shot, audio_durations)

        try:
            await provider.generate_clip(
                shot_id=shot_id,
                prompt=shot["video_prompt"],
                output_path=str(output_path),
                duration_seconds=duration,
                config=config,
            )
            job.done += 1
            await job.emit_progress(shot_id, duration=duration)
        except Exception as e:
            await job.emit_error(shot_id, str(e), retryable=True)
            continue

    await job.emit_complete({"clips": [...]})
```

---

## 6. 文件 I/O

| 操作 | 路径 |
|------|------|
| 读取分镜 | `/app/projects/{project_id}/storyboard.json` |
| 读取音频时长 | `/app/projects/{project_id}/audio_durations.json`（tts-service 写入）|
| 写入视频片段 | `/app/projects/{project_id}/clips/{shot_id}.mp4` |
| 模型路径 | `/app/models/Wan2.1-T2V-1.3B/`（只读挂载） |

---

## 7. 关键参数默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| width | 832 | 输出视频宽度（px） |
| height | 480 | 输出视频高度（px） |
| num_frames | 65 | 生成帧数（约 4s，16fps） |
| num_inference_steps | 30 | 去噪步数 |

---

## 8. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| CUDA OOM | 单张失败，emit error（retryable），继续下一张 |
| `audio_durations.json` 缺失 | Job 整体失败，提示先完成 tts-service |
| FFmpeg 冻结帧失败 | 使用原始片段，记录警告 |
| 模型文件缺失 | health 返回 503 |

---

## 9. Docker 配置

```dockerfile
FROM pytorch/pytorch:2.7.0-cuda12.8-cudnn9-devel
WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg git && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```
# requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
torch==2.7.0
transformers==4.51.3
accelerate==1.3.0
```

**环境变量：**
```
VIDEO_PROVIDER=wan_local
MODEL_TTL_SECONDS=600
```

---

## 10. Provider 实现方式：Subprocess vs Direct Import

### 背景

Wan2.1 原格式推理有两种调用方式：
1. **Direct Import**：Python 中 `import wan.text2video` 直接调用 `WanT2V.generate()`
2. **Subprocess**：通过 `subprocess` 调用 `Wan2.1/generate.py` 脚本

**v1.0 选择：Subprocess 方式**

原因：
- Wan 原格式推理代码依赖复杂的相对 import 和特定环境配置，在 Docker 容器中直接 import 需要大量路径调整
- Subprocess 方式与 MVP 验证过的方案一致，风险更低
- 模型加载/卸载由 subprocess 进程生命周期自然管理（进程结束即释放 VRAM）

### Subprocess 稳定性保障机制

由于 subprocess 方式存在进程管理、进度黑盒、并发冲突等风险，需以下多层保障：

#### Layer 1: 并发控制
```python
# 全局信号量，确保同时只有一个 generate.py 运行
# （不仅 GPU 串行，连 generate.py 调用也串行）
_generate_lock = asyncio.Semaphore(1)

async def generate_clip(...):
    async with _generate_lock:
        # 执行 subprocess
```

#### Layer 2: 超时保护 + 进程清理
```python
async def run_with_timeout(cmd, timeout=600):
    proc = await asyncio.create_subprocess_exec(*cmd, ...)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, stdout, stderr
    except asyncio.TimeoutError:
        proc.kill()  # 强制终止
        await proc.wait()
        raise RuntimeError(f"Subprocess 超时 (> {timeout}s)")
    finally:
        # 确保进程被清理，避免僵尸进程
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
```

#### Layer 3: 临时文件 + 原子写入
```python
# 先生成到临时文件，成功后再 rename
output_tmp = output_path + ".tmp.mp4"
cmd = [..."--save_file", output_tmp, ...]
# ... 执行 subprocess ...
if success and os.path.exists(output_tmp) and os.path.getsize(output_tmp) > 0:
    os.replace(output_tmp, output_path)  # 原子替换
```

#### Layer 4: 输出验证
```python
async def validate_output(video_path):
    """使用 ffprobe 验证视频文件完整性"""
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
           "-of", "default=noprint_wrappers=1:nokey=1", video_path]
    result = await run_subprocess(cmd)
    duration = float(result.stdout.strip())
    if duration < 1.0:  # 时长异常
        raise ValueError(f"视频时长异常: {duration}s")
```

#### Layer 5: 进度模拟（SSE 心跳）

由于 subprocess 无法提供逐帧进度，SSE 推送采用**阶段式进度**：
```
event: progress
data: {"shot_id":"E01_001","done":0,"total":10,"message":"启动 Wan 生成进程..."}

# ~5分钟后（进程完成时）
event: progress
data: {"shot_id":"E01_001","done":1,"total":10,"message":"生成完成 (5.2s)","skipped":false}
```

#### Layer 6: 错误捕获与重试

```python
if returncode != 0:
    # 解析 stderr 中的错误类型
    if "CUDA out of memory" in stderr:
        raise CUDAOutOfMemoryError(retryable=True)
    elif "checkpoint" in stderr.lower():
        raise ModelNotFoundError(retryable=False)
    else:
        raise SubprocessError(stderr[:500], retryable=True)
```

### 模型加载策略调整

采用 subprocess 方式后，`model_manager.py` 的行为需要调整：

- **不再需要在服务进程内加载/卸载模型**（subprocess 进程自己管理）
- `model_manager` 简化为**进程锁管理器**：确保只有一个 subprocess 在运行
- `/model/status` 返回 "subprocess_ready"（表示环境就绪，可启动生成）
- `/model/unload` 变为 kill 当前运行的 subprocess（如有）

### 未来优化路径（v2.0）

研究直接 import `wan.text2video` 方案，优势：
- 逐帧/逐步进度反馈（真正的实时 SSE）
- 更精细的显存管理（不依赖进程边界）
- 更优雅的错误捕获（Python 异常而非进程退出码）
- 支持批量推理优化（如 pipeline 并行）

---

## 11. 处理时序

```
时间（相对）   事件
t=0           POST /jobs → 202
t=0           GET events (SSE 建立)
t=0           获取 _generate_lock，启动 subprocess
t=0~5s        Wan 环境初始化（subprocess 内）
t=5~305s      E01_001 生成中（subprocess 运行，前端显示"生成中..."）
t=305s        subprocess 完成，验证输出文件
t=305s        emit progress(done=1)，释放锁
t=305s        下一个 shot 获取锁，启动 subprocess
...
```

**预期耗时（10 shots，无缓存）：** 约 52 分钟（10×5min 推理 + 进程启动开销）
