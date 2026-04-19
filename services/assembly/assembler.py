"""
FFmpeg orchestration for assembly-service.
9-step pipeline: validate → align → concat → mix_audio → merge → srt
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

from mutagen.wave import WAVE

logger = logging.getLogger(__name__)

MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() == "true"


# ─── Public entry point ────────────────────────────────────────────────────────

async def assemble(
    project_dir: Path,
    shots: list[dict],
    config: dict,
    on_progress,  # async callable(phase, message, **kwargs)
) -> dict:
    """
    Run the full 9-step assembly pipeline.
    Returns {"video_path": ..., "srt_path": ..., "duration": ...}
    """
    audio_dir = project_dir / "audio"
    clips_dir = project_dir / "clips"
    output_dir = project_dir / "output"
    output_dir.mkdir(exist_ok=True)

    # Step 1 — Validate assets
    await on_progress(phase="validating", message=f"检查素材完整性，共 {len(shots)} 个 shot")
    missing = validate_assets(project_dir, shots)
    if missing:
        raise ValueError(f"缺失素材文件：{', '.join(missing)}")

    # Step 2 — Read actual audio durations from WAV files
    await on_progress(phase="reading_durations", message="读取音频时长")
    shot_durations = _read_audio_durations(shots, audio_dir)

    # Step 3-4 — Align clip durations (freeze-frame if needed)
    aligned_clips = []
    tmp_dir = Path(tempfile.mkdtemp())
    for i, shot in enumerate(shots):
        shot_id = shot["shot_id"]
        clip_path = clips_dir / f"{shot_id}.mp4"
        action_wav = audio_dir / f"{shot_id}_action.wav"

        aligned_path = tmp_dir / f"{shot_id}_aligned.mp4"
        await on_progress(
            phase="align",
            message=f"对齐视频时长（{i + 1}/{len(shots)}）",
            done=i + 1, total=len(shots),
        )
        final_dur = await align_clip_duration(
            str(clip_path), str(action_wav) if action_wav.exists() else None,
            str(aligned_path), shot_durations[i],
        )
        shot_durations[i] = final_dur
        aligned_clips.append(str(aligned_path))

    # Step 5-6 — Concat video clips
    await on_progress(phase="concat", message="拼接视频片段")
    concat_video = str(tmp_dir / "concat.mp4")
    await concat_clips(aligned_clips, concat_video)

    # Step 7 — Mix audio
    await on_progress(phase="mix_audio", message="混合音频轨道")
    mixed_audio = str(tmp_dir / "mixed.aac")
    await mix_audio(shots, shot_durations, str(audio_dir), mixed_audio,
                    config.get("action_volume", 1.0), config.get("dialogue_volume", 1.0))

    # Step 8 — Merge video + audio
    await on_progress(phase="merge", message="合并视频与音频")
    final_video = str(output_dir / "final.mp4")
    await merge_video_audio(concat_video, mixed_audio, final_video)

    # Step 9 — Generate SRT
    await on_progress(phase="generate_srt", message="生成字幕文件")
    from srt_generator import generate_srt
    srt_content = generate_srt(shots, shot_durations)
    srt_path = output_dir / "final.srt"
    srt_path.write_text(srt_content, encoding="utf-8")

    # Measure total duration
    total_duration = sum(shot_durations)

    return {
        "video_path": final_video,
        "srt_path": str(srt_path),
        "duration": round(total_duration, 2),
    }


# ─── Step 1: Validate ─────────────────────────────────────────────────────────

def validate_assets(project_dir: Path, shots: list[dict]) -> list[str]:
    missing = []
    for shot in shots:
        sid = shot["shot_id"]
        clip = project_dir / "clips" / f"{sid}.mp4"
        action = project_dir / "audio" / f"{sid}_action.wav"
        if not (clip.exists() and clip.stat().st_size > 0):
            missing.append(f"clips/{sid}.mp4")
        if not (action.exists() and action.stat().st_size > 0):
            missing.append(f"audio/{sid}_action.wav")
    return missing


# ─── Step 2: Read durations ───────────────────────────────────────────────────

def _read_audio_durations(shots: list[dict], audio_dir: Path) -> list[float]:
    durations = []
    for shot in shots:
        sid = shot["shot_id"]
        action_wav = audio_dir / f"{sid}_action.wav"
        dialogue_wav = audio_dir / f"{sid}_dialogue.wav"

        action_dur = float(WAVE(str(action_wav)).info.length) if action_wav.exists() else 0.0
        dialogue_dur = float(WAVE(str(dialogue_wav)).info.length) if dialogue_wav.exists() else 0.0
        tts_dur = max(action_dur, dialogue_dur)

        declared = float(shot.get("duration", 4.0))
        final = max(declared, tts_dur + 0.5) if tts_dur > 0 else declared
        durations.append(final)
    return durations


# ─── Step 3-4: Align clip duration ───────────────────────────────────────────

async def align_clip_duration(
    clip_path: str,
    action_wav: str | None,
    output_path: str,
    target_duration: float,
) -> float:
    if MOCK_MODE:
        import shutil
        shutil.copy2(clip_path, output_path)
        return target_duration

    clip_dur = await _get_video_duration(clip_path)
    if target_duration <= clip_dur + 0.05:
        # No extension needed; symlink or copy
        import shutil
        shutil.copy2(clip_path, output_path)
        return clip_dur

    freeze = target_duration - clip_dur
    cmd = [
        "ffmpeg", "-i", clip_path,
        "-vf", f"tpad=stop_mode=clone:stop_duration={freeze:.3f}",
        "-t", f"{target_duration:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        output_path, "-y",
    ]
    await _run_ffmpeg(cmd)
    return target_duration


# ─── Step 5-6: Concat clips ───────────────────────────────────────────────────

async def concat_clips(clip_paths: list[str], output_path: str):
    if MOCK_MODE:
        import shutil
        shutil.copy2(clip_paths[0], output_path)
        return

    list_file = tempfile.mktemp(suffix=".txt")
    with open(list_file, "w") as f:
        for p in clip_paths:
            f.write(f"file '{p}'\n")
    try:
        cmd = [
            "ffmpeg", "-f", "concat", "-safe", "0",
            "-i", list_file,
            "-c", "copy",
            output_path, "-y",
        ]
        await _run_ffmpeg(cmd)
    finally:
        try:
            os.unlink(list_file)
        except OSError:
            pass


# ─── Step 7: Mix audio ────────────────────────────────────────────────────────

async def mix_audio(
    shots: list[dict],
    shot_durations: list[float],
    audio_dir: str,
    output_path: str,
    action_volume: float = 1.0,
    dialogue_volume: float = 1.0,
):
    if MOCK_MODE:
        # Write a silent AAC file
        dur = sum(shot_durations)
        cmd = [
            "ffmpeg", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
            "-t", str(dur), "-c:a", "aac", output_path, "-y",
        ]
        await _run_ffmpeg(cmd)
        return

    inputs: list[str] = []
    filter_parts: list[str] = []
    offset_ms = 0.0
    stream_labels: list[str] = []

    for i, (shot, dur) in enumerate(zip(shots, shot_durations)):
        sid = shot["shot_id"]
        action_path = os.path.join(audio_dir, f"{sid}_action.wav")
        dialogue_path = os.path.join(audio_dir, f"{sid}_dialogue.wav")

        if os.path.exists(action_path):
            idx = len(inputs) // 2
            inputs += ["-i", action_path]
            label = f"a{i}act"
            filter_parts.append(
                f"[{idx}]adelay={offset_ms:.0f}|{offset_ms:.0f},"
                f"volume={action_volume}[{label}]"
            )
            stream_labels.append(f"[{label}]")

        if os.path.exists(dialogue_path):
            idx = len(inputs) // 2
            inputs += ["-i", dialogue_path]
            label = f"a{i}dlg"
            filter_parts.append(
                f"[{idx}]adelay={offset_ms:.0f}|{offset_ms:.0f},"
                f"volume={dialogue_volume}[{label}]"
            )
            stream_labels.append(f"[{label}]")

        offset_ms += dur * 1000

    if not stream_labels:
        # No audio at all — generate silence
        dur = sum(shot_durations)
        cmd = [
            "ffmpeg", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", str(dur), "-c:a", "aac", output_path, "-y",
        ]
        await _run_ffmpeg(cmd)
        return

    n = len(stream_labels)
    streams = "".join(stream_labels)
    filter_parts.append(f"{streams}amix=inputs={n}:normalize=0[aout]")
    filter_complex = ";".join(filter_parts)

    cmd = (
        ["ffmpeg"] + inputs
        + ["-filter_complex", filter_complex, "-map", "[aout]",
           "-c:a", "aac", "-b:a", "128k", output_path, "-y"]
    )
    await _run_ffmpeg(cmd)


# ─── Step 8: Merge ────────────────────────────────────────────────────────────

async def merge_video_audio(video_path: str, audio_path: str, output_path: str):
    cmd = [
        "ffmpeg",
        "-i", video_path,
        "-i", audio_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-pix_fmt", "yuv420p",
        output_path, "-y",
    ]
    await _run_ffmpeg(cmd)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _run_ffmpeg(cmd: list[str]):
    logger.debug("FFmpeg: %s", " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (exit {proc.returncode}): {stderr.decode()[-500:]}")


async def _get_video_duration(path: str) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return float(out.decode().strip())
