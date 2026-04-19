import os
from .base import StoryboardProvider


def get_provider() -> StoryboardProvider:
    provider_name = os.getenv("STORYBOARD_PROVIDER", "kimi")
    mock_mode = os.getenv("MOCK_MODE", "false").lower() == "true"

    if mock_mode:
        from .mock import MockStoryboardProvider
        return MockStoryboardProvider()
    if provider_name == "kimi":
        from .kimi import KimiProvider
        return KimiProvider()
    raise ValueError(f"Unknown STORYBOARD_PROVIDER: {provider_name!r}")
