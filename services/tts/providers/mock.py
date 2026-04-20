import asyncio
import os

from .base import TTSProvider


class MockTTSProvider(TTSProvider):
    @property
    def default_action_voice(self) -> str:
        return "mock-action"

    @property
    def default_dialogue_voice(self) -> str:
        return "mock-dialogue"

    async def synthesize(self, text: str, voice: str, output_path: str) -> float:
        await asyncio.sleep(0.1)
        duration = max(1.0, len(text) * 0.05)  # rough estimate
        _write_silent_mp3(output_path, duration)
        return duration


def _write_silent_mp3(path: str, duration: float, sample_rate: int = 22050):
    """Generate a silent MP3 file using ffmpeg."""
    import subprocess
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r={sample_rate}:cl=mono",
        "-t", str(duration),
        "-acodec", "libmp3lame", "-q:a", "4",
        path,
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
