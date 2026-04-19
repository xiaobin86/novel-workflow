import os
from .base import ImageProvider


def get_provider() -> ImageProvider:
    provider_name = os.getenv("IMAGE_PROVIDER", "flux_local")
    mock_mode = os.getenv("MOCK_MODE", "false").lower() == "true"

    if mock_mode:
        from .mock import MockImageProvider
        return MockImageProvider()
    if provider_name == "flux_local":
        from .flux_local import FluxLocalProvider
        return FluxLocalProvider()
    raise ValueError(f"Unknown IMAGE_PROVIDER: {provider_name!r}")
