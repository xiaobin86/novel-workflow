import asyncio
import gc
import logging
import os

from .base import ImageProvider

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv("FLUX_MODEL_PATH", "/app/models/FLUX.1-dev")

ANIME_PREFIX = (
    "Anime Chinese manhua style, cel-shaded, flat colors, 2D animation, clean lineart. "
)


class FluxLocalProvider(ImageProvider):
    def __init__(self):
        self._pipe = None

    async def load_model(self) -> None:
        import torch
        from diffusers import FluxPipeline
        from transformers import BitsAndBytesConfig

        logger.info(f"Loading FLUX model from {MODEL_PATH}...")
        nf4_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        loop = asyncio.get_event_loop()
        pipe = await loop.run_in_executor(
            None,
            lambda: FluxPipeline.from_pretrained(
                MODEL_PATH,
                quantization_config=nf4_config,
                torch_dtype=torch.bfloat16,
            ),
        )
        pipe.enable_model_cpu_offload()
        pipe.vae.enable_slicing()
        pipe.vae.enable_tiling()
        self._pipe = pipe
        logger.info("FLUX model loaded")

    async def unload_model(self) -> None:
        import torch
        del self._pipe
        self._pipe = None
        torch.cuda.empty_cache()
        gc.collect()
        logger.info("FLUX model unloaded")

    async def generate_shot(self, shot_id: str, prompt: str, output_path: str, config: dict) -> None:
        if self._pipe is None:
            raise RuntimeError("Model not loaded; call load_model() first")

        full_prompt = ANIME_PREFIX + prompt
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._sync_generate, full_prompt, output_path, config)

    def _sync_generate(self, prompt: str, output_path: str, config: dict):
        image = self._pipe(
            prompt=prompt,
            width=config.get("width", 768),
            height=config.get("height", 768),
            num_inference_steps=config.get("num_inference_steps", 28),
            guidance_scale=config.get("guidance_scale", 3.5),
        ).images[0]
        image.save(output_path)
