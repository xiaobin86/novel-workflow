import asyncio

from .base import ImageProvider


class MockImageProvider(ImageProvider):
    async def load_model(self) -> None:
        await asyncio.sleep(0.1)

    async def unload_model(self) -> None:
        pass

    async def generate_shot(self, shot_id: str, prompt: str, output_path: str, config: dict) -> None:
        await asyncio.sleep(0.2)
        from PIL import Image
        w = config.get("width", 768)
        h = config.get("height", 768)
        img = Image.new("RGB", (w, h), color=(100, 140, 200))
        img.save(output_path)
