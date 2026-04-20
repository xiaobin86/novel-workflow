# 04 — tts-service 详细设计

**职责**：将分镜中每个 shot 的旁白（action）和台词（dialogue）生成 WAV 音频  
**端口**：8003  
**GPU**：不需要（纯 CPU）  
**外部依赖**：Azure edge-tts（免费，无需 API Key）

---

## 1. 内部架构

```
main.py (FastAPI)
│
├── POST /jobs               → job_manager.submit(GenerateTTSJob)
├── GET  /jobs/{id}/events   → job_manager.stream(job_id)
├── GET  /jobs/{id}/status   → job_manager.status(job_id)
├── POST /jobs/{id}/pause    → job_manager.pause(job_id)
├── POST /jobs/{id}/resume   → job_manager.resume(job_id)
├── POST /jobs/{id}/stop     → job_manager.stop(job_id)
└── GET  /health

job_manager.py              ← 通用 Job 管理

providers/
├── base.py                 → TTSProvider (ABC)
├── edge_tts.py             → EdgeTTSProvider (v1.0 实现)
└── __init__.py             → get_provider()
```

---

## 2. API 端点

### POST /jobs

**请求体：**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "config": {}
}
```

**响应（202）：**
```json
{
  "job_id": "tts_job_def789",
  "status": "queued"
}
```

### GET /jobs/{job_id}/events（SSE）

每个 shot 完成后推送一条 progress（旁白和台词各为独立事件）：

```
event: progress
data: {"shot_id":"E01_001","track":"action","done":1,"total":18,"filename":"E01_001_action.wav"}

event: progress
data: {"shot_id":"E01_001","track":"dialogue","done":2,"total":18,"filename":"E01_001_dialogue.wav"}

event: progress
data: {"shot_id":"E01_002","track":"action","done":3,"total":18,"filename":"E01_002_action.wav","skipped":true}

event: complete
data: {"result":{"audio_files":["E01_001_action.wav","E01_001_dialogue.wav",...],"total_tracks":18}}
```

> `total` 为实际音频文件数（action 轨数 + dialogue 轨数），不等于 shot 数量。

---

## 3. Provider 接口

### base.py

```python
from abc import ABC, abstractmethod

class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str,
        output_path: str,
    ) -> float:
        """
        将文本合成为 WAV 文件，返回实际音频时长（秒）。
        output_path 指定保存路径。
        """
        ...

    @property
    @abstractmethod
    def default_action_voice(self) -> str:
        """旁白默认声线"""
        ...

    @property
    @abstractmethod
    def default_dialogue_voice(self) -> str:
        """对话默认声线"""
        ...
```

### EdgeTTSProvider（v1.0）

```python
import edge_tts
import asyncio
from mutagen.wave import WAVE

class EdgeTTSProvider(TTSProvider):
    default_action_voice = "zh-CN-YunxiNeural"       # 旁白：男声，成熟稳重
    default_dialogue_voice = "zh-CN-XiaoxiaoNeural"  # 对话：女声，自然生动

    async def synthesize(self, text: str, voice: str, output_path: str) -> float:
        communicate = edge_tts.Communicate(text=text, voice=voice)
        await communicate.save(output_path)
        # 读取实际音频时长
        audio = WAVE(output_path)
        return audio.info.length
```

**声线选择逻辑（v1.0 固定默认值）：**
- `action` 轨（旁白）：`zh-CN-YunxiNeural`
- `dialogue` 轨（台词）：`zh-CN-XiaoxiaoNeural`
- 未来可通过 config 传入角色-声线映射表扩展

### 预留 Provider（v2.0 不实现）

```python
class ElevenLabsProvider(TTSProvider):
    """高质量情感 TTS，支持多角色声线克隆"""
    ...

class AzureCognitiveSpeechProvider(TTSProvider):
    """Azure 付费版 TTS，更多声线选择"""
    ...
```

---

## 4. 核心处理流程

```python
async def run_generate_tts_job(job: JobRecord, project_id: str, config: dict):
    project_dir = Path(f"/app/projects/{project_id}")
    storyboard = json.loads((project_dir / "storyboard.json").read_text())
    shots = storyboard["shots"]
    audio_dir = project_dir / "audio"
    audio_dir.mkdir(exist_ok=True)

    provider = get_provider()

    # 计算总任务数（action 必有，dialogue 按需）
    total_tracks = sum(1 + (1 if s.get("dialogue") else 0) for s in shots)
    job.total = total_tracks
    done = 0

    for shot in shots:
        shot_id = shot["shot_id"]

        # ── 旁白轨（action，每个 shot 必有）──
        action_path = audio_dir / f"{shot_id}_action.wav"
        if action_path.exists() and action_path.stat().st_size > 0:
            done += 1
            await job.emit_progress(shot_id, track="action", done=done, skipped=True)
        else:
            duration = await provider.synthesize(
                text=shot["action"],
                voice=provider.default_action_voice,
                output_path=str(action_path),
            )
            done += 1
            await job.emit_progress(shot_id, track="action", done=done,
                                    filename=action_path.name, duration=duration)

        # ── 对话轨（dialogue，有台词才生成）──
        if shot.get("dialogue"):
            dialogue_path = audio_dir / f"{shot_id}_dialogue.wav"
            if dialogue_path.exists() and dialogue_path.stat().st_size > 0:
                done += 1
                await job.emit_progress(shot_id, track="dialogue", done=done, skipped=True)
            else:
                duration = await provider.synthesize(
                    text=shot["dialogue"],
                    voice=provider.default_dialogue_voice,
                    output_path=str(dialogue_path),
                )
                done += 1
                await job.emit_progress(shot_id, track="dialogue", done=done,
                                        filename=dialogue_path.name, duration=duration)

    await job.emit_complete({...})
```

---

## 5. 音频时长的关键作用

TTS 生成的实际音频时长（秒）会写入 storyboard 的运行时元数据，供 video-service 使用：

```
/app/projects/{project_id}/audio_durations.json
{
  "E01_001": {"action": 5.3, "dialogue": 3.1},
  "E01_002": {"action": 6.8, "dialogue": null},
  ...
}
```

video-service 读取此文件，计算每个视频片段的实际时长：
```
clip_duration = max(shot.declared_duration, action_duration + 0.5)
```

---

## 6. 文件 I/O

| 操作 | 路径 |
|------|------|
| 读取分镜 | `/app/projects/{project_id}/storyboard.json` |
| 写入旁白音频 | `/app/projects/{project_id}/audio/{shot_id}_action.wav` |
| 写入台词音频 | `/app/projects/{project_id}/audio/{shot_id}_dialogue.wav`（有台词时） |
| 写入时长元数据 | `/app/projects/{project_id}/audio_durations.json` |

---

## 7. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| edge-tts 网络超时 | 重试 3 次（指数退避），失败则跳过当前轨道并记录错误 |
| 文本为空 | 跳过该轨道，不生成文件 |
| 文本过长（>500字） | 分段合成后拼接（edge-tts 单次限制约 500 字） |
| 输出文件损坏（大小=0） | 视为不存在，重新生成 |

---

## 8. Docker 配置

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y && rm -rf /var/lib/apt/lists/*
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
edge-tts==6.1.12
mutagen==1.47.0          # 读取 WAV 时长
```

**环境变量：**
```
TTS_PROVIDER=edge_tts
TTS_ACTION_VOICE=zh-CN-YunxiNeural
TTS_DIALOGUE_VOICE=zh-CN-XiaoxiaoNeural
```

---

## 9. 处理时序

```
Client                  tts-service            edge-tts (Azure)
  │                          │                       │
  ├─POST /jobs─────────────▶ │                       │
  │◀─202 {job_id}────────────│                       │
  ├─GET /jobs/{id}/events──▶ │                       │
  │                          │──synthesize(action)──▶│
  │◀─progress(E01_001,action)│◀─WAV data─────────────│
  │                          │──synthesize(dialogue)▶│
  │◀─progress(E01_001,dlg)───│◀─WAV data─────────────│
  ...（每个 shot 循环）
  │◀─complete────────────────│                       │
```

**预期耗时（10 shots）：** 约 2-4 分钟  
**与 image-service 的关系：** 可同时运行（tts 仅用 CPU，不占用 GPU）
