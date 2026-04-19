"""
Shared Model Manager — used by GPU services (image-service, video-service).

ModelManager:  manages a single in-process model (FLUX, etc.)
               with TTL-based auto-unload and forced unload API.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Callable, Coroutine, Literal

logger = logging.getLogger(__name__)

ModelState = Literal["unloaded", "loading", "loaded", "unloading"]


class ModelManager:
    """
    Generic GPU model lifecycle manager.

    Usage:
        manager = ModelManager(
            load_fn=my_async_load,    # async () -> model_object
            unload_fn=my_async_unload, # async (model_object) -> None
            ttl=600,
        )

        # In your job handler:
        model = await manager.get()   # auto-loads on first call
        result = model.generate(...)

        # Called by orchestrator between GPU services:
        await manager.force_unload()
    """

    def __init__(
        self,
        load_fn: Callable[[], Coroutine[Any, Any, Any]],
        unload_fn: Callable[[Any], Coroutine[Any, Any, None]],
        ttl: int | None = None,
    ):
        self._load_fn = load_fn
        self._unload_fn = unload_fn
        self._ttl = ttl or int(os.getenv("MODEL_TTL_SECONDS", "600"))
        self._model: Any = None
        self._state: ModelState = "unloaded"
        self._last_used: float = 0.0
        self._lock = asyncio.Lock()
        self._watchdog_task: asyncio.Task | None = None

    @property
    def state(self) -> ModelState:
        return self._state

    @property
    def loaded(self) -> bool:
        return self._state == "loaded"

    async def get(self) -> Any:
        """Return the loaded model, loading it if necessary."""
        async with self._lock:
            if self._state == "loaded":
                self._last_used = time.time()
                return self._model

            if self._state in ("loading", "unloading"):
                raise RuntimeError(f"Model is currently {self._state}, try again shortly")

            self._state = "loading"

        logger.info("Loading model...")
        try:
            model = await self._load_fn()
        except Exception:
            self._state = "unloaded"
            raise

        async with self._lock:
            self._model = model
            self._state = "loaded"
            self._last_used = time.time()

        logger.info("Model loaded successfully")
        self._ensure_watchdog()
        return self._model

    async def force_unload(self):
        """Unload the model immediately (called by orchestrator before switching GPU services)."""
        async with self._lock:
            if self._state != "loaded":
                return
            self._state = "unloading"

        logger.info("Unloading model (forced)...")
        try:
            await self._unload_fn(self._model)
        finally:
            async with self._lock:
                self._model = None
                self._state = "unloaded"
        logger.info("Model unloaded")

    def status_dict(self) -> dict:
        return {
            "state": self._state,
            "model_loaded": self._state == "loaded",
            "last_used_at": self._last_used or None,
            "ttl_seconds": self._ttl,
        }

    def _ensure_watchdog(self):
        if self._watchdog_task is None or self._watchdog_task.done():
            self._watchdog_task = asyncio.create_task(self._ttl_watchdog())

    async def _ttl_watchdog(self):
        """Auto-unload if idle for TTL seconds."""
        while True:
            await asyncio.sleep(60)
            async with self._lock:
                if self._state != "loaded":
                    return
                idle = time.time() - self._last_used
                if idle < self._ttl:
                    continue
                self._state = "unloading"

            logger.info(f"Model idle for {idle:.0f}s, auto-unloading...")
            try:
                await self._unload_fn(self._model)
            finally:
                async with self._lock:
                    self._model = None
                    self._state = "unloaded"
            logger.info("Model auto-unloaded (TTL expired)")
            return
