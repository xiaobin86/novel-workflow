"""
WanLocalProvider — calls Wan2.1-T2V-1.3B via subprocess.

Why subprocess (not direct import):
  - Wan2.1 original format requires sys.path.insert to the model repo
  - subprocess isolates the process; force-kill on timeout is clean
  - Semaphore enforces single-GPU usage at all times
"""
import asyncio
import logging
import os
import shutil
import tempfile

from .base import VideoProvider

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("WAN_MODEL_PATH", "/app/models/Wan2.1-T2V-1.3B")
# generate.py 在 Wan2.1 仓库目录，不在模型目录
WAN_REPO_PATH = os.getenv("WAN_REPO_PATH", "/app/wan-repo")
GENERATE_SCRIPT = os.path.join(WAN_REPO_PATH, "generate.py")
GENERATE_TIMEOUT = int(os.getenv("WAN_GENERATE_TIMEOUT", "600"))

ANIME_PREFIX = (
    "Anime Chinese manhua style, cel-shaded, flat colors, "
    "2D animation, clean lineart. "
)

# Global semaphore: only one Wan inference at a time
_sem = asyncio.Semaphore(1)


class WanLocalProvider(VideoProvider):
    async def generate_clip(
        self,
        shot_id: str,
        prompt: str,
        output_path: str,
        duration_seconds: float,
        config: dict,
    ) -> None:
        full_prompt = ANIME_PREFIX + prompt
        num_frames = config.get("num_frames", 65)
        width = config.get("width", 832)
        height = config.get("height", 480)
        steps = config.get("num_inference_steps", 30)

        tmp_path = output_path + ".tmp.mp4"

        async with _sem:
            proc = await asyncio.create_subprocess_exec(
                "python", GENERATE_SCRIPT,
                "--task", "t2v-1.3B",
                "--size", f"{width}*{height}",
                "--ckpt_dir", MODEL_PATH,
                "--offload_model", "True",   # 显存不足时 CPU 卸载
                "--t5_cpu",                   # T5 encoder 在 CPU 运行
                "--sample_steps", str(steps),
                "--sample_shift", "8",        # 推荐采样偏移
                "--base_seed", "42",
                "--prompt", full_prompt,
                "--save_file", tmp_path,
                "--frame_num", str(num_frames),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=WAN_REPO_PATH,            # 必须在 Wan2.1 仓库目录下运行
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=GENERATE_TIMEOUT
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise RuntimeError(f"Wan generation timed out after {GENERATE_TIMEOUT}s")

        if proc.returncode != 0:
            err = stderr.decode()[-500:] if stderr else ""
            raise RuntimeError(f"Wan generate.py failed (exit {proc.returncode}): {err}")

        # Validate output
        if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            raise RuntimeError(f"Wan generate.py produced no output file at {tmp_path}")

        # Freeze-extend if TTS requires longer duration than model output
        model_duration = num_frames / 16.0  # Wan outputs ~16fps
        if duration_seconds > model_duration + 0.1:
            await _freeze_extend(tmp_path, duration_seconds)

        os.replace(tmp_path, output_path)

    async def load_model(self) -> None:
        pass  # Model is loaded by subprocess; no persistent process

    async def unload_model(self) -> None:
        pass


async def _freeze_extend(video_path: str, target_duration: float):
    freeze_dur = target_duration - await _get_video_duration(video_path)
    if freeze_dur <= 0:
        return
    extended = video_path + ".ext.mp4"
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"tpad=stop_mode=clone:stop_duration={freeze_dur:.3f}",
        "-t", f"{target_duration:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        extended, "-y",
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    os.replace(extended, video_path)


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
    return float(out.decode().strip() or "0")
