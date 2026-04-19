"""
tts-service job handler.

For each shot:
  - Synthesize action (narration) WAV
  - Synthesize dialogue WAV (if present)
  - Record actual durations to audio_durations.json
"""
import json
import os
from pathlib import Path

from shared.job_manager import JobRecord
from providers.base import TTSProvider

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")


async def run_tts_job(job: JobRecord, project_id: str, provider: TTSProvider):
    project_dir = Path(PROJECTS_BASE) / project_id
    storyboard_path = project_dir / "storyboard.json"
    if not storyboard_path.exists():
        raise FileNotFoundError(f"storyboard.json not found for project {project_id}")

    storyboard = json.loads(storyboard_path.read_text(encoding="utf-8"))
    shots = storyboard["shots"]

    audio_dir = project_dir / "audio"
    audio_dir.mkdir(exist_ok=True)

    # Count total tracks
    total_tracks = sum(1 + (1 if s.get("dialogue") else 0) for s in shots)
    job.total = total_tracks
    done = 0

    # Load existing durations (resume support)
    durations_path = project_dir / "audio_durations.json"
    durations: dict = {}
    if durations_path.exists():
        durations = json.loads(durations_path.read_text(encoding="utf-8"))

    action_voice = provider.default_action_voice
    dialogue_voice = provider.default_dialogue_voice

    for shot in shots:
        shot_id = shot["shot_id"]

        # ── Action track ─────────────────────────────────────────────────────
        action_path = audio_dir / f"{shot_id}_action.wav"
        if action_path.exists() and action_path.stat().st_size > 0:
            done += 1
            await job.emit_progress(shot_id=shot_id, track="action", done=done, skipped=True)
            if shot_id not in durations:
                from mutagen.wave import WAVE
                durations.setdefault(shot_id, {})["action"] = float(WAVE(str(action_path)).info.length)
        else:
            action_text = shot.get("action", "").strip()
            if action_text:
                dur = await provider.synthesize(action_text, action_voice, str(action_path))
                durations.setdefault(shot_id, {})["action"] = dur
            done += 1
            await job.emit_progress(
                shot_id=shot_id, track="action", done=done,
                filename=action_path.name,
            )

        # ── Dialogue track ────────────────────────────────────────────────────
        if shot.get("dialogue"):
            dialogue_path = audio_dir / f"{shot_id}_dialogue.wav"
            if dialogue_path.exists() and dialogue_path.stat().st_size > 0:
                done += 1
                await job.emit_progress(shot_id=shot_id, track="dialogue", done=done, skipped=True)
                if "dialogue" not in durations.get(shot_id, {}):
                    from mutagen.wave import WAVE
                    durations.setdefault(shot_id, {})["dialogue"] = float(WAVE(str(dialogue_path)).info.length)
            else:
                dialogue_text = shot["dialogue"].strip()
                if dialogue_text:
                    dur = await provider.synthesize(dialogue_text, dialogue_voice, str(dialogue_path))
                    durations.setdefault(shot_id, {})["dialogue"] = dur
                done += 1
                await job.emit_progress(
                    shot_id=shot_id, track="dialogue", done=done,
                    filename=dialogue_path.name,
                )

        # Persist durations after each shot (incremental write)
        _write_durations(durations_path, durations)

    job.done = done
    audio_files = [f.name for f in audio_dir.iterdir() if f.suffix == ".wav"]
    await job.emit_complete({"audio_files": sorted(audio_files), "total_tracks": done})


def _write_durations(path: Path, durations: dict):
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(durations, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
