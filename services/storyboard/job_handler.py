"""
storyboard-service job handler.
Calls the provider, writes storyboard.json, emits SSE events.
"""
import json
import os
import tempfile
from pathlib import Path

from shared.job_manager import JobRecord
from providers.base import StoryboardProvider

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")


async def run_storyboard_job(
    job: JobRecord,
    project_id: str,
    text: str,
    episode: str,
    title: str,
    provider: StoryboardProvider,
):
    project_dir = Path(PROJECTS_BASE) / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    job.total = 1

    job.check_stop()
    await job.emit_progress(phase="calling_llm", message="正在调用 Kimi API...")

    storyboard = await provider.generate(text=text, episode=episode, title=title, config={})
    shots = storyboard.get("shots", [])

    await job.emit_progress(
        phase="parsing",
        message=f"解析分镜 JSON，共 {len(shots)} 个镜头",
        done=1,
        total=1,
    )

    # Atomic write: write to tmp then rename
    storyboard_path = project_dir / "storyboard.json"
    tmp_path = storyboard_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(storyboard, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(storyboard_path)

    # Also persist input text
    (project_dir / "input.txt").write_text(text, encoding="utf-8")

    job.done = 1
    await job.emit_complete({
        "shot_count": len(shots),
        "storyboard_path": str(storyboard_path),
    })
