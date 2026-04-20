# 06 — assembly-service 详细设计

**职责**：将视频片段、音频文件合并为最终 MP4，并生成 SRT 字幕  
**端口**：8005  
**GPU**：不需要（纯 CPU，FFmpeg）  
**外部依赖**：无（FFmpeg 系统工具）  
**前置条件**：image/tts/video 三个服务均已完成

---

## 1. 内部架构

```
main.py (FastAPI)
│
├── POST /jobs               → job_manager.submit(AssembleJob)
├── GET  /jobs/{id}/events   → job_manager.stream(job_id)
├── GET  /jobs/{id}/status   → job_manager.status(job_id)
├── POST /jobs/{id}/pause    → job_manager.pause(job_id)
├── POST /jobs/{id}/resume   → job_manager.resume(job_id)
├── POST /jobs/{id}/stop     → job_manager.stop(job_id)
└── GET  /health

job_manager.py

assembler.py                ← FFmpeg 编排逻辑（核心）
srt_generator.py            ← SRT 字幕生成
```

> assembly-service 逻辑固定，无 Provider 抽象层（FFmpeg 是唯一实现）

---

## 2. API 端点

### POST /jobs

**请求体：**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "config": {
    "action_volume": 1.0,
    "dialogue_volume": 1.0
  }
}
```

**响应（202）：**
```json
{
  "job_id": "asm_job_jkl345",
  "status": "queued"
}
```

### GET /jobs/{job_id}/events（SSE）

拼装分阶段推送：

```
event: progress
data: {"phase":"validating","message":"检查素材完整性，共 10 个 shot"}

event: progress
data: {"phase":"concat","message":"拼接视频片段（1/10）","done":1,"total":10}

event: progress
data: {"phase":"mix_audio","message":"混合音频轨道"}

event: progress
data: {"phase":"generate_srt","message":"生成字幕文件"}

event: complete
data: {"result":{"video_path":"output/final.mp4","srt_path":"output/final.srt","duration":68.5}}
```

---

## 3. 核心拼装流程（assembler.py）

### 3.1 整体流程

```
Step 1  素材验证        检查所有 clips/ 和 audio/ 文件存在且不为空
Step 2  音频时长重读     从实际 WAV 文件读取时长（以文件为准，不信任 JSON）
Step 3  视频时长对齐     每个 clip 实际时长 = max(clip实际时长, action_tts时长 + 0.5s)
Step 4  视频片段补齐     时长不足的 clip 冻结最后一帧延长
Step 5  生成 concat 列表  写 concat.txt（FFmpeg concat demuxer 格式）
Step 6  拼接视频         FFmpeg concat → 无音频主视频
Step 7  混音            FFmpeg amix → 旁白轨 + 台词轨（带时间偏移）
Step 8  合并            FFmpeg 将视频 + 混音合并，输出 final.mp4
Step 9  生成 SRT        根据各 shot 时间轴写 final.srt
```

### 3.2 视频片段补齐（步骤 3-4）

```python
async def align_clip_duration(
    clip_path: str,
    action_wav: str,
    output_path: str,
) -> float:
    """
    计算目标时长，若 clip 不足则冻结最后一帧补齐。
    返回最终时长（秒）。
    """
    clip_dur = await get_video_duration(clip_path)
    action_dur = get_wav_duration(action_wav) if os.path.exists(action_wav) else 0
    target_dur = max(clip_dur, action_dur + 0.5) if action_dur > 0 else clip_dur

    if target_dur <= clip_dur:
        # 不需要补齐，直接复用
        return clip_dur

    # 冻结最后一帧
    freeze_duration = target_dur - clip_dur
    cmd = [
        "ffmpeg", "-i", clip_path,
        "-vf", f"tpad=stop_mode=clone:stop_duration={freeze_duration:.3f}",
        "-t", f"{target_dur:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y"
    ]
    await run_ffmpeg(cmd)
    return target_dur
```

### 3.3 视频拼接（步骤 5-6）

```python
async def concat_clips(clip_paths: list[str], output_path: str):
    """
    使用 concat demuxer（不用 xfade filter）。
    原因：xfade 在超过 3 个片段时 offset 累积计算有误，会丢失内容。
    """
    concat_list = "/tmp/concat_list.txt"
    with open(concat_list, "w") as f:
        for p in clip_paths:
            f.write(f"file '{p}'\n")

    cmd = [
        "ffmpeg",
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c", "copy",              # 无重编码，速度快
        output_path, "-y"
    ]
    await run_ffmpeg(cmd)
```

### 3.4 音频混音（步骤 7）

```python
async def mix_audio(
    shots: list[dict],
    shot_durations: list[float],
    audio_dir: str,
    output_path: str,
    action_volume: float = 1.0,
    dialogue_volume: float = 1.0,
):
    """
    将各 shot 的音频按时间偏移混合到一条轨道。
    使用 adelay 为每个音频片段设置起始时间偏移。
    """
    inputs = []
    filter_parts = []
    offset_ms = 0.0

    for i, (shot, dur) in enumerate(zip(shots, shot_durations)):
        shot_id = shot["shot_id"]
        action_path = f"{audio_dir}/{shot_id}_action.mp3"
        dialogue_path = f"{audio_dir}/{shot_id}_dialogue.mp3"

        if os.path.exists(action_path):
            inputs += ["-i", action_path]
            idx = len(inputs) // 2 - 1
            filter_parts.append(
                f"[{idx}]adelay={offset_ms:.0f}|{offset_ms:.0f},"
                f"volume={action_volume}[a{i}action]"
            )

        if os.path.exists(dialogue_path):
            inputs += ["-i", dialogue_path]
            idx = len(inputs) // 2 - 1
            filter_parts.append(
                f"[{idx}]adelay={offset_ms:.0f}|{offset_ms:.0f},"
                f"volume={dialogue_volume}[a{i}dlg]"
            )

        offset_ms += dur * 1000

    # 合并所有轨道
    streams = "".join(f"[a{i}action]" for i, s in enumerate(shots) if has_action(s))
    streams += "".join(f"[a{i}dlg]" for i, s in enumerate(shots) if has_dialogue(s))
    n = streams.count("[")
    filter_parts.append(f"{streams}amix=inputs={n}:normalize=0[aout]")

    cmd = ["ffmpeg"] + inputs + [
        "-filter_complex", ";".join(filter_parts),
        "-map", "[aout]",
        "-c:a", "aac", "-b:a", "128k",
        output_path, "-y"
    ]
    await run_ffmpeg(cmd)
```

### 3.5 最终合并（步骤 8）

```python
async def merge_video_audio(video_path, audio_path, output_path):
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-i", audio_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-pix_fmt", "yuv420p",   # 兼容各类播放器
        output_path, "-y"
    ]
    await run_ffmpeg(cmd)
```

---

## 4. SRT 字幕生成（srt_generator.py）

```python
def generate_srt(shots: list[dict], shot_durations: list[float]) -> str:
    lines = []
    current_time = 0.0

    for i, (shot, dur) in enumerate(zip(shots, shot_durations)):
        start = seconds_to_srt_time(current_time)
        end = seconds_to_srt_time(current_time + dur)

        # SRT 内容：旁白文本（action）
        text = shot.get("action", "").strip()
        if shot.get("dialogue"):
            text += f"\n「{shot['dialogue'].strip()}」"

        lines.append(f"{i+1}\n{start} --> {end}\n{text}\n")
        current_time += dur

    return "\n".join(lines)

def seconds_to_srt_time(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
```

---

## 5. 素材验证（步骤 1）

```python
def validate_assets(project_dir: Path, shots: list[dict]) -> list[str]:
    """返回缺失文件列表，非空则 Job 失败"""
    missing = []
    for shot in shots:
        sid = shot["shot_id"]
        clip = project_dir / "clips" / f"{sid}.mp4"
        action = project_dir / "audio" / f"{sid}_action.mp3"
        if not (clip.exists() and clip.stat().st_size > 0):
            missing.append(f"clips/{sid}.mp4")
        if not (action.exists() and action.stat().st_size > 0):
            missing.append(f"audio/{sid}_action.mp3")
    return missing
```

---

## 6. 文件 I/O

| 操作 | 路径 |
|------|------|
| 读取分镜 | `/app/projects/{project_id}/storyboard.json` |
| 读取音频时长 | `/app/projects/{project_id}/audio_durations.json` |
| 读取视频片段 | `/app/projects/{project_id}/clips/{shot_id}.mp4` |
| 读取音频 | `/app/projects/{project_id}/audio/{shot_id}_action.mp3` |
| 读取台词音频 | `/app/projects/{project_id}/audio/{shot_id}_dialogue.mp3`（可选）|
| 写入最终视频 | `/app/projects/{project_id}/output/final.mp4` |
| 写入字幕 | `/app/projects/{project_id}/output/final.srt` |

---

## 7. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| 素材文件缺失 | validate_assets 返回缺失列表，Job 整体失败，提示用户 |
| FFmpeg 不在 PATH | 启动时检测，health 返回 503 |
| FFmpeg 命令失败 | 捕获 stderr，emit error，Job 失败 |
| 输出目录不存在 | 自动创建 `output/` |

---

## 8. Docker 配置

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
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
mutagen==1.47.0      # 读取 MP3 时长
```

---

## 9. 处理时序

```
时间（相对）  阶段
t=0          POST /jobs → 202
t=0          GET events (SSE)
t=0~5s       validate_assets（快速，仅检查文件存在）
t=5~15s      align_clip_duration × 10（每张约 1s，含 FFmpeg 冻结帧）
t=15~30s     concat_clips（视频拼接，约 15s for 10 clips）
t=30~60s     mix_audio（音频混合，约 30s）
t=60~90s     merge_video_audio（最终合并，约 30s）
t=90s        generate_srt（<1s）
t=90s        emit complete
```

**预期耗时：** 约 1-3 分钟
