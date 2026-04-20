# 12 — 图片就绪即启动视频生成：技术设计

**对应 PRD**: `docs/product/prd/incremental-video-generation.md`  
**状态**: ✅ 已确认，待开发  
**创建日期**: 2026-04-20  

---

## 一、设计目标（最终确认版）

| 维度 | 设计决策 |
|---|---|
| **启动条件** | `pending_shots`（有图片但无视频的分镜）数量 > 0 |
| **按钮语义** | 点击 = 生成「当前所有有图片但无视频的分镜」，快照式，不跟踪后续新增图片 |
| **后端简化** | 前端把待生成的 `shot_ids` 列表传给后端，后端只处理这个列表 |
| **完成判定** | `video_count >= image_count`（不是 `>= 全部分镜数`） |
| **批次结束** | 一批生成完后（成功或失败），前端 SWR 重新计算 pending，按钮恢复可点 |
| **时长来源** | `storyboard.json` 的 `shot.duration` 字段，不读 `audio_durations.json` |
| **TTS 依赖** | 完全移除，视频步骤独立于 TTS |

---

## 二、状态层：`readState` 返回 shot 级文件信息

### 2.1 新增接口类型

**`apps/web/lib/project-store.ts`**

```typescript
/** 磁盘实际文件状态，计算字段，不持久化到 state.json */
export interface ShotFileCounts {
  image_shots: string[];   // images/ 中存在的 shot_id 列表（已去扩展名）
  video_shots: string[];   // clips/ 中存在的 shot_id 列表（已去 .mp4）
}

export interface ProjectState {
  // ...现有字段不变...
  shot_file_counts?: ShotFileCounts;  // ← 新增，计算字段
}
```

### 2.2 `computeShotFileCounts()`

```typescript
async function computeShotFileCounts(id: string): Promise<ShotFileCounts> {
  const dir = projectDir(id);
  const [imgFiles, clipFiles] = await Promise.all([
    fs.readdir(path.join(dir, "images")).catch(() => [] as string[]),
    fs.readdir(path.join(dir, "clips")).catch(() => [] as string[]),
  ]);
  return {
    image_shots: imgFiles
      .filter(f => /\.(png|jpg|webp)$/i.test(f))
      .map(f => f.replace(/\.[^.]+$/, "")),     // E01_001.png → E01_001
    video_shots: clipFiles
      .filter(f => /\.mp4$/i.test(f))
      .map(f => f.replace(/\.mp4$/i, "")),       // E01_001.mp4 → E01_001
  };
}
```

### 2.3 `readState()` 末尾附加

```typescript
export async function readState(id: string): Promise<ProjectState> {
  // ...现有逻辑...

  // 附加 shot 级文件信息（不写入 state.json，每次读取时实时计算）
  state.shot_file_counts = await computeShotFileCounts(id);
  return state;
}
```

### 2.4 `validateStepStatuses` — video 步骤完成判定变更

原逻辑：`video_count >= storyboard_shot_count` → completed  
**新逻辑**：`video_count >= image_count` → completed

```typescript
// validateStepStatuses 内，处理 video 步骤时：
if (step === "video") {
  const videoCount = (result.data as VideoResult).clips?.length ?? 0;
  // 取真实图片数（real source，非 state 近似）
  const imgFiles = await fs.readdir(path.join(dir, "images")).catch(() => [] as string[]);
  const imageCount = imgFiles.filter(f => /\.(png|jpg|webp)$/i.test(f)).length;

  const expectedStatus: StepStatus =
    imageCount === 0       ? "pending"
    : videoCount === 0    ? "pending"
    : videoCount >= imageCount ? "completed"
    : "stopped";

  if (currentStatus !== expectedStatus && currentStatus !== "in_progress") {
    state.steps[step].status = expectedStatus;
    // ...
  }
}
```

> **注意**：`validateStepStatuses` 中已有 `if (currentStatus === "in_progress") continue` 的保护（BUG-004 修复），video 步骤运行中不会被干扰。

---

## 三、前端层：`canStart` 与启动参数

### 3.1 pending_shots 计算（在组件内）

**`apps/web/app/projects/[id]/page.tsx`**

```typescript
// 在 ProjectPage 组件或传入 StepCard 的位置计算：
const imageShotSet = new Set(state?.shot_file_counts?.image_shots ?? []);
const videoShotSet = new Set(state?.shot_file_counts?.video_shots ?? []);
const pendingVideoShots = [...imageShotSet].filter(id => !videoShotSet.has(id));
// pendingVideoShots: 有图片但无视频的 shot_id 列表
```

### 3.2 `canStart("video")` 条件

```typescript
if (step === "video") {
  // 方案 C：真实磁盘来源（通过 state.shot_file_counts）
  return pendingVideoShots.length > 0;
}
```

取消原有的 `tts.status === "completed"` 和 `image.status === "completed"` 依赖。

### 3.3 `startStep` 传参变更

```typescript
async function startStep(step: StepName) {
  setStarting(step);
  try {
    const body: Record<string, unknown> = {};
    if (step === "video") {
      // 快照式：点击时把当前 pending_shots 传给后端
      body.shot_ids = pendingVideoShots;
    }
    await fetch(`/api/pipeline/${projectId}/${step}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await mutate();
  } finally {
    setStarting(null);
  }
}
```

### 3.4 按钮文案

| 状态 | 按钮文案 |
|---|---|
| video=pending，pendingVideoShots>0 | `开始执行` |
| video=stopped，pendingVideoShots>0 | `继续生成（N 个）` |
| video=stopped，pendingVideoShots=0 | 不显示（此时 completed） |
| video=completed | 不显示 |

```typescript
// StepCard 按钮 label 调整（video 步骤专用）：
const label =
  step === "video" && pendingVideoShots.length > 0
    ? status === "stopped"
      ? `继续生成（${pendingVideoShots.length} 个）`
      : "开始执行"
    : status === "stopped" ? "重新开始"
    : "开始执行";
```

---

## 四、接口层：start route 透传 shot_ids

**`apps/web/app/api/pipeline/[id]/[step]/start/route.ts`**

```typescript
// 在构建 serviceBody 时，video 步骤透传 shot_ids
if (stepName === "video") {
  serviceBody = {
    project_id: projectId,
    config: { ...(STEP_CONFIGS.video ?? {}) },
    shot_ids: (userConfig.shot_ids as string[]) ?? null,  // 透传给 video-service
  };
} else {
  serviceBody.config = { ...(STEP_CONFIGS[stepName] ?? {}), ...userConfig };
}
```

---

## 五、后端层：video-service

### 5.1 `POST /jobs` 请求体扩展

**`services/video/main.py`**

```python
class StartJobRequest(BaseModel):
    project_id: str
    config: dict = {}
    shot_ids: list[str] | None = None   # ← 新增，None 表示生成全部待处理分镜
```

### 5.2 `job_handler.py` 全量重构

```python
import json, logging, os, traceback
from pathlib import Path
from shared.job_manager import JobRecord
from providers.base import VideoProvider

logger = logging.getLogger(__name__)
PROJECTS_BASE = os.getenv("PROJECTS_BASE_DIR", "/app/projects")
IMAGE_EXTENSIONS = ["png", "jpg", "webp"]
DEFAULT_CONFIG = {"width": 832, "height": 480, "num_frames": 65, "num_inference_steps": 30}


def find_shot_image(images_dir: Path, shot_id: str) -> Path | None:
    """查找分镜对应图片（支持 png/jpg/webp）。"""
    for ext in IMAGE_EXTENSIONS:
        p = images_dir / f"{shot_id}.{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def get_clip_duration(shot: dict) -> float:
    """分镜视频时长 = storyboard 声明的 duration（Assembly 负责音画同步）。"""
    return float(shot.get("duration", 4.0))


async def run_generate_clips_job(
    job: JobRecord,
    project_id: str,
    config: dict,
    shot_ids: list[str] | None,
    provider: VideoProvider,
):
    project_dir = Path(PROJECTS_BASE) / project_id
    storyboard = json.loads(
        (project_dir / "storyboard.json").read_text(encoding="utf-8-sig")
    )
    all_shots = storyboard["shots"]

    # 只处理前端传来的 shot_ids（快照式）；None 时处理全部分镜
    if shot_ids is not None:
        shot_id_set = set(shot_ids)
        shots_to_process = [s for s in all_shots if s["shot_id"] in shot_id_set]
    else:
        shots_to_process = all_shots

    images_dir = project_dir / "images"
    clips_dir  = project_dir / "clips"
    clips_dir.mkdir(exist_ok=True)

    cfg = {**DEFAULT_CONFIG, **config}
    job.total = len(shots_to_process)
    clips = []

    for shot in shots_to_process:
        job.check_stop()
        shot_id   = shot["shot_id"]
        output    = clips_dir / f"{shot_id}.mp4"

        # ① 已有视频 → 断点续传跳过
        if output.exists() and output.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(
                shot_id=shot_id, done=job.done,
                message="Skipped (already exists)", skipped=True,
            )
            clips.append({"shot_id": shot_id, "filename": f"{shot_id}.mp4"})
            continue

        # ② 图片安全检查（防止文件在快照后被删）
        image_path = find_shot_image(images_dir, shot_id)
        if image_path is None:
            await job.emit_error(
                f"Image not found for shot {shot_id}",
                shot_id=shot_id, retryable=False,
            )
            continue

        # ③ 生成视频
        duration = get_clip_duration(shot)
        try:
            await provider.generate_clip(
                shot_id=shot_id,
                prompt=shot["video_prompt"],
                output_path=str(output),
                duration_seconds=duration,
                config=cfg,
            )
            job.done += 1
            await job.emit_progress(
                shot_id=shot_id, done=job.done,
                message=f"Generated clip ({duration:.1f}s)", skipped=False,
            )
            clips.append({
                "shot_id": shot_id,
                "filename": f"{shot_id}.mp4",
                "duration": duration,
            })
        except Exception as exc:
            logger.error(f"generate_clip failed for {shot_id}: {exc}\n{traceback.format_exc()}")
            await job.emit_error(str(exc), shot_id=shot_id, retryable=True)

    # 本批次完成（成功或部分失败）
    await job.emit_complete({"clips": clips, "total": len(shots_to_process)})
    # validateStepStatuses 会在下次 readState 时根据 image_count vs video_count
    # 自动计算真实完成状态（completed / stopped）
```

### 5.3 `main.py` 传参更新

```python
@app.post("/jobs", status_code=202)
async def start_job(req: StartJobRequest):
    from job_handler import run_generate_clips_job
    provider = get_provider()
    job = await job_manager.submit(
        req.project_id,
        lambda job: run_generate_clips_job(
            job, req.project_id, req.config,
            req.shot_ids,   # ← 透传
            provider,
        ),
    )
    return {"job_id": job.job_id, "status": job.status.value}
```

---

## 六、完成状态流转

```
用户点击「开始执行」→ 传入 pending_shots = ["E01_003", "E01_005"]
  │
  └─ 视频服务只处理这 2 个分镜
     ├─ E01_003：生成成功 ✓
     └─ E01_005：生成成功 ✓
         ↓
     emit complete（本批次完成）
         ↓
  events/route.ts → updateStep("video", { status: "completed" })
         ↓
  下次 SWR 轮询 → readState → validateStepStatuses：
    image_count = 10, video_count = 7
    7 < 10 → 修正为 "stopped"
         ↓
  前端：video=stopped，pendingVideoShots = 3 个
  按钮显示「继续生成（3 个）」

（图片全部完成后再次点击）
         ↓
  video_count = 10, image_count = 10 → "completed"
```

---

## 七、变更文件汇总

| 文件 | 变更内容 | 估计行数 |
|---|---|---|
| `apps/web/lib/project-store.ts` | 新增 `ShotFileCounts` 接口、`computeShotFileCounts()`、`readState` 附加调用、`validateStepStatuses` video 完成判定 | +40 行 |
| `apps/web/app/projects/[id]/page.tsx` | `pendingVideoShots` 计算、`canStart("video")` 条件、`startStep` 传参、按钮文案 | +20 行 |
| `apps/web/app/api/pipeline/[id]/[step]/start/route.ts` | video 步骤透传 `shot_ids` | +8 行 |
| `services/video/main.py` | `StartJobRequest` 新增 `shot_ids` 字段、`start_job` 传参 | +5 行 |
| `services/video/job_handler.py` | 完整重构：去掉 audio_durations 依赖、接受 shot_ids 过滤、图片安全检查、时长直接用 duration | 改动 ~50 行 |
| `docs/technical/design/05-service-video.md` | 更新前置条件、时序图 | ~10 行 |

**不需要改动**：
- `services/shared/job_manager.py`（不需要 `emit_partial_stop`，由 `validateStepStatuses` 自动修正）
- `apps/web/app/api/pipeline/[id]/[step]/events/route.ts`（`stopped` 事件已处理）

---

## 八、与旧设计的对比

| 维度 | 旧设计（v1.0 草稿） | 新设计（v1.1 确认版） |
|---|---|---|
| 前端判断来源 | `state.file_counts.image`（数量） | `state.shot_file_counts`（shot_id 列表） |
| pending shots | 前端无法得知具体是哪些 | 前端自己 diff 得到，直接传给后端 |
| 后端接口 | 后端自己扫描图片目录 | 前端传 `shot_ids`，后端直接处理 |
| 图片未就绪处理 | 跳过 + `emit_partial_stop` | 不存在此场景（前端传的就是有图片的列表） |
| `job_manager.py` | 需新增 `emit_partial_stop()` | **无需改动** |
| 完成判定 | `video_count >= storyboard_shot_count` | `video_count >= image_count` |

---

*技术文档版本：v1.1（与用户确认，等待「可以开发了」指令后开始实现）*
