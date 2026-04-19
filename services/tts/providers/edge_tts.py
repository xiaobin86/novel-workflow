import asyncio
import logging
import os

import edge_tts
from mutagen.wave import WAVE

from .base import TTSProvider

logger = logging.getLogger(__name__)

MAX_CHUNK_LEN = 480  # edge-tts single-call limit ~500 chars; keep buffer


class EdgeTTSProvider(TTSProvider):
    @property
    def default_action_voice(self) -> str:
        return os.getenv("TTS_ACTION_VOICE", "zh-CN-YunxiNeural")

    @property
    def default_dialogue_voice(self) -> str:
        return os.getenv("TTS_DIALOGUE_VOICE", "zh-CN-XiaoxiaoNeural")

    async def synthesize(self, text: str, voice: str, output_path: str) -> float:
        if not text or not text.strip():
            raise ValueError("Empty text passed to TTS synthesize()")

        chunks = _split_text(text, MAX_CHUNK_LEN)

        if len(chunks) == 1:
            await self._synthesize_chunk(chunks[0], voice, output_path)
        else:
            # Multi-chunk: synthesize each to a temp file, then concat with FFmpeg
            import tempfile
            tmp_dir = tempfile.mkdtemp()
            tmp_files = []
            for i, chunk in enumerate(chunks):
                tmp_path = os.path.join(tmp_dir, f"chunk_{i}.wav")
                await self._synthesize_chunk(chunk, voice, tmp_path)
                tmp_files.append(tmp_path)
            await _concat_wavs(tmp_files, output_path)
            for f in tmp_files:
                try:
                    os.unlink(f)
                except OSError:
                    pass

        audio = WAVE(output_path)
        return float(audio.info.length)

    async def _synthesize_chunk(self, text: str, voice: str, output_path: str):
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(text=text, voice=voice)
                await communicate.save(output_path)
                return
            except Exception as exc:
                logger.warning(f"edge-tts attempt {attempt + 1} failed: {exc}")
                if attempt == 2:
                    raise
                await asyncio.sleep(2 ** attempt)


def _split_text(text: str, max_len: int) -> list[str]:
    if len(text) <= max_len:
        return [text]
    # Split on sentence boundaries
    import re
    sentences = re.split(r"(?<=[。！？.!?])", text)
    chunks, current = [], ""
    for s in sentences:
        if len(current) + len(s) > max_len and current:
            chunks.append(current.strip())
            current = s
        else:
            current += s
    if current.strip():
        chunks.append(current.strip())
    return chunks or [text]


async def _concat_wavs(input_paths: list[str], output_path: str):
    import tempfile
    list_file = tempfile.mktemp(suffix=".txt")
    with open(list_file, "w") as f:
        for p in input_paths:
            f.write(f"file '{p}'\n")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-f", "concat", "-safe", "0", "-i", list_file,
        "-c", "copy", output_path, "-y",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    try:
        os.unlink(list_file)
    except OSError:
        pass
