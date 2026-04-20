import asyncio
import json
import logging
import os
import traceback
from pathlib import Path

from shared.job_manager import JobRecord
from providers.base import VideoProvider

logger = logging.getLogger(__name__)

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")
IMAGE_EXTENSIONS = ["png", "jpg", "webp"]

DEFAULT_CONFIG = {
    "width": 832,
    "height": 480,
    "num_frames": 65,
    "num_inference_steps": 30,
}

# Cooldown between shots to let GPU memory fully release (seconds).
# MVP experience: 5s prevents OOM on 12GB VRAM.
SHOT_COOLDOWN_SECONDS = 5


def find_shot_image(images_dir: Path, shot_id: str) -> Path | None:
    """Return the first existing image file for shot_id, or None."""
    for ext in IMAGE_EXTENSIONS:
        p = images_dir / f"{shot_id}.{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def get_clip_duration(shot: dict) -> float:
    """Clip duration comes directly from the storyboard declaration.
    Audio sync is handled by the Assembly step, not here."""
    return float(shot.get("duration", 4.0))


async def run_generate_clips_job(
    job: JobRecord,
    project_id: str,
    config: dict,
    shot_ids: list[str] | None,
    provider: VideoProvider,
):
    project_dir = Path(PROJECTS_BASE) / project_id

    storyboard = json.loads(
        (project_dir / "storyboard.json").read_text(encoding="utf-8-sig")
    )
    all_shots = storyboard["shots"]

    # Snapshot-based filtering: only process the shot_ids the frontend passed.
    # None means "process all shots" (e.g. regenerate-all flow).
    if shot_ids is not None:
        shot_id_set = set(shot_ids)
        shots_to_process = [s for s in all_shots if s["shot_id"] in shot_id_set]
    else:
        shots_to_process = all_shots

    images_dir = project_dir / "images"
    clips_dir = project_dir / "clips"
    clips_dir.mkdir(exist_ok=True)

    cfg = {**DEFAULT_CONFIG, **config}
    job.total = len(shots_to_process)

    logger.info(
        f"Starting video generation for {project_id}: "
        f"{len(shots_to_process)} shots (total storyboard: {len(all_shots)})"
    )

    clips = []
    for idx, shot in enumerate(shots_to_process, start=1):
        job.check_stop()
        shot_id = shot["shot_id"]
        output_path = clips_dir / f"{shot_id}.mp4"

        # ① Already exists → resume / skip
        if output_path.exists() and output_path.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(
                shot_id=shot_id, done=job.done,
                message="Skipped (already exists)", skipped=True,
            )
            clips.append({"shot_id": shot_id, "filename": f"{shot_id}.mp4"})
            continue

        # ② Safety check: image must exist (might have been deleted after snapshot)
        image_path = find_shot_image(images_dir, shot_id)
        if image_path is None:
            logger.warning(f"[{shot_id}] Image not found — skipping")
            await job.emit_error(
                f"Image not found for shot {shot_id}",
                shot_id=shot_id,
                retryable=False,
            )
            continue

        # ③ Generate
        duration = get_clip_duration(shot)
        logger.info(
            f"[{shot_id}] ({idx}/{len(shots_to_process)}) "
            f"Generating clip, duration={duration:.1f}s, image={image_path.name}"
        )

        try:
            await provider.generate_clip(
                shot_id=shot_id,
                prompt=shot["video_prompt"],
                output_path=str(output_path),
                duration_seconds=duration,
                config=cfg,
            )
            job.done += 1
            await job.emit_progress(
                shot_id=shot_id, done=job.done,
                message=f"Generated clip ({duration:.1f}s)", skipped=False,
            )
            clips.append({
                "shot_id": shot_id,
                "filename": f"{shot_id}.mp4",
                "duration": duration,
            })
            logger.info(f"[{shot_id}] Clip generated successfully")
        except Exception as exc:
            logger.error(
                f"generate_clip failed for {shot_id}: {exc}\n{traceback.format_exc()}"
            )
            await job.emit_error(str(exc), shot_id=shot_id, retryable=True)
            continue

        # Cooldown between shots to prevent GPU OOM
        if idx < len(shots_to_process):
            logger.info(f"Cooling down for {SHOT_COOLDOWN_SECONDS}s before next shot...")
            await asyncio.sleep(SHOT_COOLDOWN_SECONDS)

    # Batch complete (success or partial failure).
    # validateStepStatuses will determine the true final status on the next
    # SWR poll by comparing image_count vs video_count on disk.
    logger.info(
        f"Video generation batch complete for {project_id}: "
        f"{len(clips)}/{len(shots_to_process)} clips generated"
    )
    await job.emit_complete({"clips": clips, "total": len(shots_to_process)})
