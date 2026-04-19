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
from shared.model_manager import ModelManager
from providers import get_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

_provider = get_provider()
job_manager = JobManager()
model_manager = ModelManager(
    load_fn=_provider.load_model,
    unload_fn=lambda _: _provider.unload_model(),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    gc_task = asyncio.create_task(_gc_loop())
    signal.signal(signal.SIGTERM, lambda *_: gc_task.cancel())
    yield
    await model_manager.force_unload()
    gc_task.cancel()


async def _gc_loop():
    while True:
        await asyncio.sleep(300)
        await job_manager.gc()


app = FastAPI(title="image-service", lifespan=lifespan)
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
    from job_handler import run_generate_images_job

    # Ensure model is loaded before job starts
    await model_manager.get()

    job = await job_manager.submit(
        req.project_id,
        lambda job: run_generate_images_job(job, req.project_id, req.config, _provider),
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
    return model_manager.status_dict()


@app.post("/model/unload", status_code=204)
async def unload_model():
    await model_manager.force_unload()


@app.get("/health")
async def health():
    model_ok = os.path.isdir(os.getenv("FLUX_MODEL_PATH", "/app/models/FLUX.1-dev"))
    return {
        "status": "ok" if model_ok else "degraded",
        "model_loaded": model_manager.loaded,
        "reason": None if model_ok else "model not found",
    }
