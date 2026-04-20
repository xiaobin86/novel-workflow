"""
Shared Job Manager — used by all 5 services.
Each service instantiates one JobManager and passes it to route handlers.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from enum import Enum
from typing import Any, AsyncIterator

from fastapi import HTTPException
from fastapi.responses import StreamingResponse


class JobStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobRecord:
    def __init__(self, job_id: str, project_id: str):
        self.job_id = job_id
        self.project_id = project_id
        self.status = JobStatus.QUEUED
        self.done = 0
        self.total = 0
        self.result: dict | None = None
        self.error: str | None = None
        self.created_at = time.time()
        self.updated_at = time.time()
        self._task: asyncio.Task | None = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._subscribers: list[asyncio.Queue] = []
        self._pause_event: asyncio.Event = asyncio.Event()
        self._pause_event.set()  # default: running
        self._stop_requested: bool = False

    def _touch(self):
        self.updated_at = time.time()

    async def emit_progress(self, **kwargs):
        payload = {"done": self.done, "total": self.total, **kwargs}
        await self._broadcast("progress", payload)

    async def emit_complete(self, result: dict):
        self.status = JobStatus.COMPLETED
        self.result = result
        self._touch()
        await self._broadcast("complete", {"result": result})
        await self._broadcast("__done__", {})

    async def emit_error(self, message: str, shot_id: str | None = None, retryable: bool = False):
        payload = {"message": message, "retryable": retryable}
        if shot_id:
            payload["shot_id"] = shot_id
        await self._broadcast("error", payload)

    async def _broadcast(self, event: str, data: dict):
        msg = (event, data)
        for q in list(self._subscribers):
            await q.put(msg)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    # ── Pause / Resume / Stop helpers ──────────────────────────────────────

    async def check_pause(self):
        """Job handlers call this between work units; blocks if paused,
        raises CancelledError if stop was requested."""
        if self._stop_requested:
            raise asyncio.CancelledError("Stop requested")
        await self._pause_event.wait()

    async def pause(self):
        if self.status not in (JobStatus.IN_PROGRESS, JobStatus.QUEUED):
            raise HTTPException(status_code=409, detail=f"Cannot pause job in status {self.status.value}")
        self.status = JobStatus.PAUSED
        self._pause_event.clear()
        self._touch()
        await self._broadcast("paused", {"message": "Job paused by user"})

    async def resume(self):
        if self.status != JobStatus.PAUSED:
            raise HTTPException(status_code=409, detail=f"Cannot resume job in status {self.status.value}")
        self.status = JobStatus.IN_PROGRESS
        self._pause_event.set()
        self._touch()
        await self._broadcast("resumed", {"message": "Job resumed"})

    def request_stop(self):
        self._stop_requested = True
        self._pause_event.set()  # wake up if currently paused
        self._touch()

    def to_status_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "project_id": self.project_id,
            "status": self.status.value,
            "done": self.done,
            "total": self.total,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class JobManager:
    # Keep completed jobs for up to 1 hour before garbage-collecting.
    JOB_TTL = 3600

    def __init__(self):
        self._jobs: dict[str, JobRecord] = {}
        self._lock = asyncio.Lock()

    def _make_id(self) -> str:
        return uuid.uuid4().hex[:12]

    async def submit(self, project_id: str, coro) -> JobRecord:
        """
        Create a new JobRecord, start the coroutine as a background task, return the record.
        `coro` must be a coroutine that accepts (job: JobRecord) as its only argument.
        """
        job_id = self._make_id()
        job = JobRecord(job_id=job_id, project_id=project_id)

        async def _run():
            job.status = JobStatus.IN_PROGRESS
            job._touch()
            try:
                await coro(job)
            except asyncio.CancelledError:
                job.status = JobStatus.CANCELLED
                job._touch()
                await job._broadcast("__done__", {})
            except Exception as exc:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job._touch()
                await job.emit_error(str(exc))
                await job._broadcast("__done__", {})

        async with self._lock:
            self._jobs[job_id] = job

        job._task = asyncio.create_task(_run())
        return job

    def get(self, job_id: str) -> JobRecord:
        job = self._jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")
        return job

    def status(self, job_id: str) -> dict:
        return self.get(job_id).to_status_dict()

    async def pause(self, job_id: str):
        job = self.get(job_id)
        await job.pause()

    async def resume(self, job_id: str):
        job = self.get(job_id)
        await job.resume()

    async def stop(self, job_id: str):
        job = self.get(job_id)
        job.request_stop()
        if job._task and not job._task.done():
            job._task.cancel()
        job.status = JobStatus.CANCELLED
        job._touch()
        await job._broadcast("stopped", {"message": "Job stopped by user", "done": job.done, "total": job.total})

    async def cancel(self, job_id: str):
        job = self.get(job_id)
        if job._task and not job._task.done():
            job._task.cancel()
        job.status = JobStatus.CANCELLED
        job._touch()

    def sse_response(self, job_id: str) -> StreamingResponse:
        """Return a StreamingResponse that replays all future SSE events for job_id."""
        job = self.get(job_id)

        async def _generate() -> AsyncIterator[str]:
            # If already done, replay the terminal event immediately.
            if job.status == JobStatus.COMPLETED:
                yield _sse("complete", {"result": job.result})
                return
            if job.status in (JobStatus.FAILED, JobStatus.CANCELLED):
                yield _sse("error", {"message": job.error or "job failed"})
                return
            # If paused, emit paused then continue waiting for resumed/complete/error
            if job.status == JobStatus.PAUSED:
                yield _sse("paused", {"message": "Job is paused"})

            q = job.subscribe()
            try:
                while True:
                    event, data = await q.get()
                    if event == "__done__":
                        break
                    yield _sse(event, data)
            finally:
                job.unsubscribe(q)

        return StreamingResponse(
            _generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def gc(self):
        """Garbage-collect expired jobs. Call periodically from a background task."""
        now = time.time()
        async with self._lock:
            expired = [
                jid for jid, j in self._jobs.items()
                if j.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)
                and now - j.updated_at > self.JOB_TTL
            ]
            for jid in expired:
                del self._jobs[jid]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
