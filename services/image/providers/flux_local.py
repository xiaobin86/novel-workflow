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
            # enable_model_cpu_offload：由 accelerate 管理各组件的 GPU/CPU 调度
            # 注意：之前此处会崩溃是因为 WSL2 容器缺少 libnvidia-ptxjitcompiler.so.1
            # （PTX JIT 编译器缺失 → CUDA kernel JIT 失败 → 进程无声死亡）
            # 现在 entrypoint.sh 已将 WSL2 驱动路径注入 LD_LIBRARY_PATH，不再崩溃。
            # accelerate 1.3.0 对 bitsandbytes NF4 量化模型有专门处理：
            # 量化张量保持在 CUDA 不被 offload，其余模块（T5、VAE 等）按需调度。
            torch.cuda.empty_cache()
            pipe.enable_model_cpu_offload()
            pipe.vae.enable_slicing()
            pipe.vae.enable_tiling()
            logger.info("Pipeline ready (cpu_offload enabled, PTX JIT available via WSL2 driver)")
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
            logger.warning(f"[{shot_id}] Model not loaded, auto-loading...")
            await self.load_model()

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
