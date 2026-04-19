import json
import os
from pathlib import Path

from shared.job_manager import JobRecord
from providers.base import VideoProvider

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")

DEFAULT_CONFIG = {
    "width": 832,
    "height": 480,
    "num_frames": 65,
    "num_inference_steps": 30,
}


def _calculate_clip_duration(shot: dict, audio_durations: dict) -> float:
    shot_id = shot["shot_id"]
    declared = float(shot.get("duration", 4.0))
    durations = audio_durations.get(shot_id, {})
    action_dur = durations.get("action", 0.0) or 0.0
    dialogue_dur = durations.get("dialogue", 0.0) or 0.0
    tts_total = max(action_dur, dialogue_dur)
    return max(declared, tts_total + 0.5) if tts_total > 0 else declared


async def run_generate_clips_job(job: JobRecord, project_id: str, config: dict, provider: VideoProvider):
    project_dir = Path(PROJECTS_BASE) / project_id

    storyboard = json.loads((project_dir / "storyboard.json").read_text(encoding="utf-8"))
    shots = storyboard["shots"]

    dur_path = project_dir / "audio_durations.json"
    if not dur_path.exists():
        raise FileNotFoundError("audio_durations.json not found — run tts-service first")
    audio_durations = json.loads(dur_path.read_text(encoding="utf-8"))

    clips_dir = project_dir / "clips"
    clips_dir.mkdir(exist_ok=True)

    cfg = {**DEFAULT_CONFIG, **config}
    job.total = len(shots)

    clips = []
    for shot in shots:
        shot_id = shot["shot_id"]
        output_path = clips_dir / f"{shot_id}.mp4"

        if output_path.exists() and output_path.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(shot_id=shot_id, done=job.done, message="Skipped (already exists)", skipped=True)
            clips.append({"shot_id": shot_id, "filename": f"{shot_id}.mp4"})
            continue

        duration = _calculate_clip_duration(shot, audio_durations)

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
            clips.append({"shot_id": shot_id, "filename": f"{shot_id}.mp4", "duration": duration})
        except Exception as exc:
            await job.emit_error(str(exc), shot_id=shot_id, retryable=True)
            continue

    await job.emit_complete({"clips": clips, "total": len(shots)})
