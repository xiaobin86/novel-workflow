import asyncio
import os

from .base import VideoProvider


class MockVideoProvider(VideoProvider):
    async def generate_clip(
        self,
        shot_id: str,
        prompt: str,
        output_path: str,
        duration_seconds: float,
        config: dict,
    ) -> None:
        await asyncio.sleep(0.3)
        w = config.get("width", 832)
        h = config.get("height", 480)
        # Generate a short black video with ffmpeg
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-f", "lavfi", "-i", f"color=black:size={w}x{h}:rate=16",
            "-t", str(duration_seconds),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            output_path, "-y",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

    async def load_model(self) -> None:
        pass

    async def unload_model(self) -> None:
        pass
