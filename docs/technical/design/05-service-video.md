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

## 10. 处理时序

```
时间（相对）   事件
t=0           POST /jobs → 202
t=0           GET events (SSE 建立)
t=0~120s      Wan 模型加载（首次，原格式 16.6GB，约 2min）
t=120s        开始 E01_001（5min/shot）
t=420s        E01_001 完成，emit progress(done=1)
t=720s        E01_002 完成，emit progress(done=2)
...
t=120+10×300  全部 10 个 shot 完成，emit complete
              编排器调用 POST /model/unload
```

**预期耗时（10 shots，无缓存）：** 约 52 分钟（2min 加载 + 10×5min 推理）
