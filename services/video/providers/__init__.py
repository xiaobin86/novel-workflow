import os
from .base import VideoProvider


def get_provider() -> VideoProvider:
    provider_name = os.getenv("VIDEO_PROVIDER", "wan_local")
    mock_mode = os.getenv("MOCK_MODE", "false").lower() == "true"

    if mock_mode:
        from .mock import MockVideoProvider
        return MockVideoProvider()
    if provider_name == "wan_local":
        from .wan_local import WanLocalProvider
        return WanLocalProvider()
    raise ValueError(f"Unknown VIDEO_PROVIDER: {provider_name!r}")
