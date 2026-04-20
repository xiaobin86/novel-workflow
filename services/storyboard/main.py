import asyncio
import logging
import os
import signal
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.job_manager import JobManager
from providers import get_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

job_manager = JobManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    gc_task = asyncio.create_task(_gc_loop())

    def _handle_sigterm(*_):
        logger.info("SIGTERM received, shutting down gracefully")
        gc_task.cancel()

    signal.signal(signal.SIGTERM, _handle_sigterm)
    yield
    gc_task.cancel()


async def _gc_loop():
    while True:
        await asyncio.sleep(300)
        await job_manager.gc()


app = FastAPI(title="storyboard-service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def _global_handler(request, exc):
    logger.exception("Unhandled exception")
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ── Request / Response models ─────────────────────────────────────────────────

class StartJobRequest(BaseModel):
    project_id: str
    text: str
    episode: str = "E01"
    title: str = ""
    config: dict = {}


# ── Routes ───────────────────────────────────────────────────────────────────

@app.post("/jobs", status_code=202)
async def start_job(req: StartJobRequest):
    from job_handler import run_storyboard_job
    provider = get_provider()
    job = await job_manager.submit(
        req.project_id,
        lambda job: run_storyboard_job(job, req.project_id, req.text, req.episode, req.title, provider),
    )
    return {"job_id": job.job_id, "status": job.status.value}


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    return job_manager.sse_response(job_id)


@app.get("/jobs/{job_id}/status")
async def job_status(job_id: str):
    return job_manager.status(job_id)


@app.post("/jobs/{job_id}/stop", status_code=200)
async def stop_job(job_id: str):
    await job_manager.stop(job_id)
    return {"job_id": job_id, "status": "stopped"}


@app.delete("/jobs/{job_id}", status_code=204)
async def cancel_job(job_id: str):
    await job_manager.cancel(job_id)


@app.get("/health")
async def health():
    return {"status": "ok"}
