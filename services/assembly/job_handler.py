import json
import os
from pathlib import Path

from shared.job_manager import JobRecord
from assembler import assemble

PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")


async def run_assembly_job(job: JobRecord, project_id: str, config: dict):
    project_dir = Path(PROJECTS_BASE) / project_id
    storyboard_path = project_dir / "storyboard.json"
    if not storyboard_path.exists():
        raise FileNotFoundError(f"storyboard.json not found for project {project_id}")

    storyboard = json.loads(storyboard_path.read_text(encoding="utf-8"))
    shots = storyboard["shots"]
    job.total = len(shots)

    async def on_progress(phase: str, message: str, **kwargs):
        await job.emit_progress(phase=phase, message=message, **kwargs)

    result = await assemble(project_dir, shots, config, on_progress)
    job.done = len(shots)
    await job.emit_complete(result)
