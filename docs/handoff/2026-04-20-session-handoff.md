# Handoff Document — 2026-04-20 Session

**Branch**: `feature/per-item-delete`  
**Commit**: `1d3c676`  
**Author**: Sisyphus Agent Session  
**Status**: Active development, ready for testing  

---

## 1. Session Overview

### Goals Achieved
1. ✅ Video service Docker stability fixes (subprocess logging, cooldown, config)
2. ✅ Frontend: "全部重新生成" → "全部删除" (Delete All without regeneration)
3. ✅ Fix individual delete not refreshing artifact list
4. ✅ Fix page refresh during generation not showing previously generated items
5. ✅ Replace fixed 500ms delay with state-confirmation refresh mechanism

### In Progress / Pending
- ⏳ Docker image build for video-service (previous attempts timed out during apt-get)
- ⏳ Image service bug investigation ("Model not loaded" after ~13 generations)

---

## 2. Changes Summary

### 2.1 Frontend (`apps/web/`)

#### `app/projects/[id]/page.tsx`
**What changed**: Major refactor of step control and artifact display logic

**Key changes**:
- `deleteStep()`: Now calls reset API, then refreshes project state (`mutate`) to confirm status changed to `pending`, THEN refreshes artifacts. Removed fixed 500ms delay.
- `deleteItem()`: Same pattern — state first, then artifacts, with `revalidate: true`.
- `StepArtifactsWrapper`: 
  - Always fetches disk artifacts (removed `activelyRunning ? null :` guard)
  - Added `useEffect` to re-fetch full artifact list when `progressArtifacts.length` increases
  - Passes `diskResult` directly to `StepArtifacts` (not null during active)
- `StepCard`: Removed dead `onRegenerate` prop, wired `onDelete={deleteStep}`

**Why**: Previous logic had race conditions where artifact refresh happened before backend state update was visible.

#### `components/step-artifacts.tsx`
**What changed**: No functional changes — formatting only (CRLF line endings)

#### `app/api/pipeline/[id]/[step]/reset/route.ts`
**What changed**: Added `Cache-Control: no-store` headers to response

**Why**: Prevent browser/proxy from caching the reset response or subsequent artifact reads.

#### `app/api/projects/[id]/artifacts/[step]/route.ts`
**What changed**: Added `Cache-Control: no-store` headers to response

**Why**: Ensure artifact list reads always hit the filesystem, not a stale cache.

### 2.2 Video Service (`services/video/`)

#### `providers/wan_local.py`
**What changed**: Complete subprocess reliability overhaul

**Key additions**:
- `subprocess_logging_reader()`: Streams stdout/stderr to logger with `[shot_id][wan]` prefix
- `_classify_error()`: Parses stderr to classify: CUDA OOM, checkpoint error, missing module, Python traceback
- `sample_guide_scale=6`: Wan2.1 recommended parameter for T2V-1.3B
- `_MIN_FILE_SIZE = 1024`: Validates generated files are > 1KB (not just > 0)
- Safer timeout cleanup: `proc.kill()` + `await proc.wait()` in `finally` block

#### `job_handler.py`
**What changed**: Added shot-to-shot cooldown and enhanced logging

**Key additions**:
- `SHOT_COOLDOWN_SECONDS = 5`: `asyncio.sleep(5)` between each clip generation
- Enhanced per-shot logging with duration metadata
- Better error handling with retryable/non-retryable classification

#### `Dockerfile`
**What changed**: Added `ENV PYTHONUNBUFFERED=1`

#### `requirements.txt`
**What changed**: Added `numpy>=1.23.5` (Wan2.1 runtime dependency)

### 2.3 Docker Compose (`docker-compose.yml`)
**What changed**: Video service configuration enhancements

**Added**:
- `shm_size: "4gb"` (required for CUDA IPC)
- Environment variables: `PYTHONUNBUFFERED=1`, `CUDA_LAUNCH_BLOCKING=1`, `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`

### 2.4 Documentation (`docs/`)

#### `bugs.md`
**Added**: BUG-004 — Video service subprocess stability

**Pattern**: 
- **Symptom**: Docker logs show no subprocess output, CUDA OOM after consecutive shots
- **Root cause**: stdout/stderr piped but not logged; no cooldown between shots
- **Fix**: Subprocess logging + shot cooldown + Docker shm_size

---

## 3. Technical Decisions

### 3.1 State-Confirmation Refresh (vs Fixed Delay)
**Problem**: After delete, immediate artifact refresh could still read old files due to filesystem sync delay.

**Rejected approach**: Fixed 500ms `setTimeout`
- Fragile: filesystem sync time varies by load and OS
- User experience: arbitrary delay feels laggy

**Chosen approach**: Sequential state confirmation
1. Call delete API → backend deletes files + updates state.json to `pending`
2. Refresh project state (`mutate`) → confirms step status is now `pending`
3. Only then refresh artifact list (`globalMutate`) → reads from disk

**Why this works**: The state.json update is the backend's atomic signal that deletion is complete. By confirming this state change before reading artifacts, we eliminate the race condition without guessing timing.

### 3.2 Always-Fetch During In-Progress
**Problem**: Page refresh during generation showed only new items from SSE, not previously generated ones.

**Previous logic**: `activelyRunning ? null : artifactsKey` — disabled disk reads during generation.

**New logic**: Always fetch disk artifacts. SSE progress artifacts are merged with disk result.

**Why**: Disk is the source of truth. SSE events are ephemeral (lost on refresh). By always reading disk, we ensure continuity across page refreshes.

### 3.3 Video Service Subprocess Pattern
**Problem**: In-process model caused GPU memory fragmentation and crash after ~13 images (image service pattern).

**Chosen approach**: Keep subprocess model for video (don't refactor to persistent model).

**Rationale**: Subprocess provides process isolation — a crash only kills one generation, not the whole service. The cooldown between shots mitigates the startup overhead.

---

## 4. Known Issues & Next Steps

### 4.1 Video Service Docker Build ⏳
**Status**: Not yet built
**Previous attempts**: Timed out during `apt-get install` (10+ minute network download)
**Recommended approach**: Run `docker compose build video-service` in a terminal with stable network, then `docker compose up -d video-service`

### 4.2 Image Service "Model Not Loaded" Bug 🔍
**Status**: Under investigation
**Symptom**: After ~13 successful image generations, `flux_local.py` raises `RuntimeError("Model not loaded; call load_model() first")`
**Current theory**: 
- `ModelManager` TTL watchdog may be auto-unloading model mid-job
- Or `model_manager.get()` refresh pattern has a race condition
- Or Python garbage collection is dropping the `_model` reference

**Investigation in progress**: 3 parallel agents researching:
1. `flux_local.py` + `job_handler.py` source analysis
2. FLUX/diffusers model unloading patterns in long loops
3. Image vs video service architecture comparison

**Reference**: Video service uses subprocess-per-generation (stateless), while image service uses persistent in-process model. Image service lacks:
- Shot-to-shot cooldown
- Timeout on generation
- Output file size validation (> 1KB)
- Error classification (CUDA OOM vs model error)

**Recommended fix direction**: 
1. Add `asyncio.Semaphore(1)` around `generate_shot` for GPU isolation
2. Add 2-3 second cooldown between shots in `image/job_handler.py`
3. Add timeout wrapper in `flux_local.py::generate_shot`
4. Investigate `ModelManager` TTL logic — may need to disable auto-unload during active jobs

### 4.3 Frontend TypeScript
**Status**: Clean (LSP diagnostics: 0 errors)
**Note**: `page.tsx` now uses `useRef` for `prevProgressLength` — ensure this is imported from React.

---

## 5. Testing Checklist

### Frontend
- [ ] Click "删除全部" on a completed step → artifacts disappear, status becomes "待执行"
- [ ] Click delete icon on individual artifact → item disappears immediately
- [ ] Start generation, refresh page mid-job → previously generated items visible
- [ ] During generation, new items appear in real-time
- [ ] Delete all during generation (should be blocked by backend 409 guard)

### Video Service (after Docker build)
- [ ] Start video generation → Docker logs show subprocess output per shot
- [ ] Generate > 5 clips → 5-second cooldown visible between each
- [ ] Inspect generated files → all > 1KB
- [ ] Stop mid-generation → graceful cleanup, no zombie processes

### Image Service (pending fix)
- [ ] Generate > 15 images in one job → should not crash with "Model not loaded"

---

## 6. Files Modified (in commit `1d3c676`)

```
apps/web/app/api/pipeline/[id]/[step]/reset/route.ts        (+6, -0)
apps/web/app/api/projects/[id]/artifacts/[step]/route.ts    (+11, -0)
apps/web/app/projects/[id]/page.tsx                         (+81, -36)
apps/web/components/step-artifacts.tsx                      (+64, -64)  [formatting]
docker-compose.yml                                          (+7, -0)
docs/bugs.md                                                (+77, -0)
docs/technical/design/12-incremental-video-generation.md    (+494, -236)
services/video/Dockerfile                                   (+2, -0)
services/video/providers/wan_local.py                       (+102, -0)
services/video/requirements.txt                             (+1, -0)
```

---

## 7. Architecture Notes for Next Session

### SWR Cache Keys
- Project state: `/api/projects/{projectId}` (managed by `useProjectState`)
- Step artifacts: `/api/projects/{projectId}/artifacts/{step}` (used by `StepArtifactsWrapper`)

### State Flow
```
User clicks "删除全部"
  → ConfirmDialog → onConfirm() → deleteStep(step)
    → POST /api/pipeline/{id}/{step}/reset
      → Backend: delete files → update state.json to pending
    → mutate(projectState)  [confirm status=pending]
    → globalMutate(artifactsKey)  [read fresh disk state]
```

### Video Service Job Flow
```
POST /generate
  → JobManager.enqueue()
    → run_generate_video_clips_job()
      → for each shot:
        → provider.generate_clip() [subprocess]
          → python generate.py ...
            → streams stdout/stderr to logs
            → validates output > 1KB
        → asyncio.sleep(SHOT_COOLDOWN_SECONDS)
```

---

## 8. Contacts & References

- **Bug knowledge base**: `docs/bugs.md` (BUG-004 for video service)
- **Video service design doc**: `docs/technical/design/12-incremental-video-generation.md`
- **Frontend rules**: `.ai/specs/coding.md`
- **DevOps rules**: `.ai/specs/devops.md`
- **Reference MVP script**: `D:\work\novel-comic-drama-2\batch_generate_wan.py`

---

*End of handoff. Next session should prioritize: (1) complete Docker build for video-service, (2) investigate and fix image service "Model not loaded" bug.*
