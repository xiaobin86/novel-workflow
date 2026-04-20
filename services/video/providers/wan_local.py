"""
WanLocalProvider — calls Wan2.1-T2V-1.3B via subprocess.

Why subprocess (not direct import):
  - Wan2.1 original format requires sys.path.insert to the model repo
  - subprocess isolates the process; force-kill on timeout is clean
  - Semaphore enforces single-GPU usage at all times

Lessons from batch_generate_wan.py (MVP):
  - Stream output to logs for Docker visibility (don't hide in PIPE)
  - 5s cooldown between shots prevents OOM
  - Validate output file size > 1KB (not just > 0)
  - sample_guide_scale=6 recommended by Wan2.1 README for T2V-1.3B
"""
import asyncio
import logging
import os

from .base import VideoProvider

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("WAN_MODEL_PATH", "/app/models/Wan2.1-T2V-1.3B")
WAN_REPO_PATH = os.getenv("WAN_REPO_PATH", "/app/wan-repo")
GENERATE_SCRIPT = os.path.join(WAN_REPO_PATH, "generate.py")
GENERATE_TIMEOUT = int(os.getenv("WAN_GENERATE_TIMEOUT", "600"))

ANIME_PREFIX = (
    "Anime Chinese manhua style, cel-shaded, flat colors, "
    "2D animation, clean lineart. "
)

# Minimum valid output file size (bytes). Corrupted/empty files are usually < 1KB.
_MIN_FILE_SIZE = 1024

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

        cmd = [
            "python", GENERATE_SCRIPT,
            "--task", "t2v-1.3B",
            "--size", f"{width}*{height}",
            "--ckpt_dir", MODEL_PATH,
            "--offload_model", "True",
            "--t5_cpu",
            "--sample_steps", str(steps),
            "--sample_shift", "8",
            "--sample_guide_scale", "6",   # Wan2.1 README recommends 6 for T2V-1.3B
            "--base_seed", "42",
            "--prompt", full_prompt,
            "--save_file", tmp_path,
            "--frame_num", str(num_frames),
        ]

        logger.info(f"[{shot_id}] Starting Wan generation (timeout={GENERATE_TIMEOUT}s)")
        logger.info(f"[{shot_id}] Command: {' '.join(cmd)}")

        proc = None
        async with _sem:
            try:
                # Inherit parent's stdout/stderr so logs stream directly to Docker.
                # PIPE buffers everything in memory until completion; if the process
                # is OOM-killed, all buffered output is lost, making diagnosis
                # impossible. With inherited streams, docker logs capture output
                # in real time and partial logs survive SIGKILL.
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=None,  # inherit
                    stderr=None,  # inherit
                    cwd=WAN_REPO_PATH,
                )
            except Exception as exc:
                raise RuntimeError(f"Failed to start Wan subprocess: {exc}") from exc

            try:
                await asyncio.wait_for(proc.wait(), timeout=GENERATE_TIMEOUT)
            except asyncio.TimeoutError:
                logger.error(f"[{shot_id}] Timeout after {GENERATE_TIMEOUT}s — killing Wan process")
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass
                raise RuntimeError(f"Wan generation timed out after {GENERATE_TIMEOUT}s")

        if proc.returncode != 0:
            err_text = stderr.decode(errors="replace")[-800:] if stderr else ""
            raise _classify_error(proc.returncode, err_text)

        # Validate output file
        if not os.path.exists(tmp_path):
            raise RuntimeError(f"Wan generate.py produced no output file at {tmp_path}")
        file_size = os.path.getsize(tmp_path)
        if file_size < _MIN_FILE_SIZE:
            raise RuntimeError(f"Wan output file too small ({file_size} bytes) — likely corrupted")

        logger.info(f"[{shot_id}] Wan generation succeeded, file size={file_size} bytes")

        # Freeze-extend if TTS requires longer duration than model output
        model_duration = num_frames / 16.0  # Wan outputs ~16fps
        if duration_seconds > model_duration + 0.1:
            logger.info(f"[{shot_id}] Extending video from {model_duration:.1f}s to {duration_seconds:.1f}s")
            await _freeze_extend(tmp_path, duration_seconds)

        os.replace(tmp_path, output_path)
        logger.info(f"[{shot_id}] Saved clip to {output_path}")

    async def load_model(self) -> None:
        pass  # Model is loaded by subprocess; no persistent process

    async def unload_model(self) -> None:
        pass


def _classify_error(returncode: int, stderr: str) -> RuntimeError:
    """Parse stderr to return a more specific error type."""
    stderr_lower = stderr.lower()
    if "cuda out of memory" in stderr_lower or "oom" in stderr_lower:
        return RuntimeError(f"CUDA OOM during Wan generation: {stderr[-500:]}")
    if "checkpoint" in stderr_lower or "ckpt" in stderr_lower:
        return RuntimeError(f"Wan model checkpoint error: {stderr[-500:]}")
    if "no module named" in stderr_lower:
        return RuntimeError(f"Wan dependency missing: {stderr[-500:]}")
    return RuntimeError(f"Wan generate.py failed (exit {returncode}): {stderr[-500:]}")


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
