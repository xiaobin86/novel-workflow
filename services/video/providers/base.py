from abc import ABC, abstractmethod


class VideoProvider(ABC):
    @abstractmethod
    async def generate_clip(
        self,
        shot_id: str,
        prompt: str,
        output_path: str,
        duration_seconds: float,
        config: dict,
    ) -> None:
        """Generate a video clip at output_path."""
        ...
