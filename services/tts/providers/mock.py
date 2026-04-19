import asyncio
import struct
import wave
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
        _write_silent_wav(output_path, duration)
        return duration


def _write_silent_wav(path: str, duration: float, sample_rate: int = 22050):
    num_samples = int(sample_rate * duration)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * num_samples)
