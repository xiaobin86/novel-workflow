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
        from diffusers import FluxPipeline, FluxTransformer2DModel, BitsAndBytesConfig
        from transformers import T5EncoderModel

        logger.info(f"Loading FLUX model from {MODEL_PATH}...")

        def _load():
            # Step 1: 4-bit 量化 transformer（将 23GB 压至 ~6GB）
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
            )
            logger.info("Loading transformer with 4-bit NF4 quantization...")
            transformer = FluxTransformer2DModel.from_pretrained(
                MODEL_PATH,
                subfolder="transformer",
                quantization_config=bnb_config,
                torch_dtype=torch.float16,
                local_files_only=True,
            )

            # Step 2: T5 text encoder FP16（由 cpu_offload 管理）
            logger.info("Loading T5 text encoder (FP16)...")
            text_encoder_2 = T5EncoderModel.from_pretrained(
                MODEL_PATH,
                subfolder="text_encoder_2",
                torch_dtype=torch.float16,
                local_files_only=True,
                low_cpu_mem_usage=True,
            )

            # Step 3: 组装 pipeline
            logger.info("Assembling FluxPipeline...")
            pipe = FluxPipeline.from_pretrained(
                MODEL_PATH,
                transformer=transformer,
                text_encoder_2=text_encoder_2,
                torch_dtype=torch.float16,
                local_files_only=True,
            )
            torch.cuda.empty_cache()
            pipe.enable_model_cpu_offload()
            pipe.vae.enable_slicing()
            pipe.vae.enable_tiling()
            # NOTE: torch.compile(mode="max-autotune") crashes on Blackwell (sm_120)
            # with bitsandbytes NF4 quantization — C-level SIGSEGV, no Python traceback.
            # Skipping torch.compile until bitsandbytes + Triton Blackwell support matures.
            logger.info("Pipeline ready (torch.compile skipped for bitsandbytes compat)")
            return pipe

        loop = asyncio.get_event_loop()
        self._pipe = await loop.run_in_executor(None, _load)
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
        import torch
        seed = config.get("seed", 42)
        generator = torch.Generator("cuda").manual_seed(seed)
        image = self._pipe(
            prompt=prompt,
            width=config.get("width", 768),
            height=config.get("height", 768),
            num_inference_steps=config.get("num_inference_steps", 15),
            guidance_scale=config.get("guidance_scale", 3.5),
            max_sequence_length=config.get("max_sequence_length", 256),
            generator=generator,
        ).images[0]
        image.save(output_path)
        torch.cuda.empty_cache()
