import json
import logging
import os
import traceback
from pathlib import Path

from shared.job_manager import JobRecord
from providers.base import ImageProvider

logger = logging.getLogger(__name__)

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")

DEFAULT_CONFIG = {
    "width": 768,
    "height": 768,
    "num_inference_steps": 28,
    "guidance_scale": 3.5,
}


async def run_generate_images_job(job: JobRecord, project_id: str, config: dict, provider: ImageProvider):
    project_dir = Path(PROJECTS_BASE) / project_id
    storyboard = json.loads((project_dir / "storyboard.json").read_text(encoding="utf-8-sig"))
    shots = storyboard["shots"]
    images_dir = project_dir / "images"
    images_dir.mkdir(exist_ok=True)

    cfg = {**DEFAULT_CONFIG, **config}
    job.total = len(shots)

    for shot in shots:
        shot_id = shot["shot_id"]
        output_path = images_dir / f"{shot_id}.png"

        if output_path.exists() and output_path.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(shot_id=shot_id, done=job.done, message="Skipped (already exists)", skipped=True)
            continue

        try:
            await provider.generate_shot(
                shot_id=shot_id,
                prompt=shot["image_prompt"],
                output_path=str(output_path),
                config=cfg,
            )
            job.done += 1
            await job.emit_progress(shot_id=shot_id, done=job.done, message=f"Generated {shot_id}.png", skipped=False)
        except Exception as exc:
            logger.error(f"generate_shot failed for {shot_id}: {exc}\n{traceback.format_exc()}")
            await job.emit_error(str(exc), shot_id=shot_id, retryable=True)
            continue

    clips = [{"shot_id": s["shot_id"], "filename": f"{s['shot_id']}.png"} for s in shots]
    await job.emit_complete({"images": clips, "total": len(shots)})
