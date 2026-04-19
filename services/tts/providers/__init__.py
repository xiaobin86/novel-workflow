import os
from .base import TTSProvider


def get_provider() -> TTSProvider:
    provider_name = os.getenv("TTS_PROVIDER", "edge_tts")
    mock_mode = os.getenv("MOCK_MODE", "false").lower() == "true"

    if mock_mode:
        from .mock import MockTTSProvider
        return MockTTSProvider()
    if provider_name == "edge_tts":
        from .edge_tts import EdgeTTSProvider
        return EdgeTTSProvider()
    raise ValueError(f"Unknown TTS_PROVIDER: {provider_name!r}")
