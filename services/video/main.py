import asyncio
import logging
import os
import signal
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.job_manager import JobManager
from providers import get_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_provider = get_provider()
job_manager = JobManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    gc_task = asyncio.create_task(_gc_loop())
    signal.signal(signal.SIGTERM, lambda *_: gc_task.cancel())
    yield
    gc_task.cancel()


async def _gc_loop():
    while True:
        await asyncio.sleep(300)
        await job_manager.gc()


app = FastAPI(title="video-service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def _global(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": str(exc)})


class StartJobRequest(BaseModel):
    project_id: str
    config: dict = {}


@app.post("/jobs", status_code=202)
async def start_job(req: StartJobRequest):
    from job_handler import run_generate_clips_job
    job = await job_manager.submit(
        req.project_id,
        lambda job: run_generate_clips_job(job, req.project_id, req.config, _provider),
    )
    return {"job_id": job.job_id, "status": job.status.value}


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    return job_manager.sse_response(job_id)


@app.get("/jobs/{job_id}/status")
async def job_status(job_id: str):
    return job_manager.status(job_id)


@app.delete("/jobs/{job_id}", status_code=204)
async def cancel_job(job_id: str):
    await job_manager.cancel(job_id)


@app.get("/model/status")
async def model_status():
    return {"state": "subprocess", "model_loaded": False, "note": "Wan uses subprocess, no persistent process"}


@app.post("/model/unload", status_code=204)
async def unload_model():
    # No-op for subprocess mode; kept for API compatibility with orchestrator
    pass


@app.get("/health")
async def health():
    wan_path = os.getenv("WAN_MODEL_PATH", "/app/models/Wan2.1-T2V-1.3B")
    model_ok = os.path.isdir(wan_path)
    return {
        "status": "ok" if model_ok else "degraded",
        "model_loaded": False,
        "reason": None if model_ok else "Wan model directory not found",
    }
