from abc import ABC, abstractmethod


class ImageProvider(ABC):
    @abstractmethod
    async def generate_shot(self, shot_id: str, prompt: str, output_path: str, config: dict) -> None:
        """Generate a single PNG image at output_path."""
        ...

    @abstractmethod
    async def load_model(self) -> None: ...

    @abstractmethod
    async def unload_model(self) -> None: ...
