# 12 — 图片就绪即启动视频生成：技术设计

**对应 PRD**: `docs/product/prd/incremental-video-generation.md`  
**状态**: 草稿，待评审  
**创建日期**: 2026-04-20  

---

## 一、整体思路

本特性的核心是将视频步骤的启动条件从「所有图片已完成」改为「至少有一张图片存在（磁盘真实来源）」，并在视频服务内部逐镜头检查图片是否就绪，跳过尚未就绪的分镜。

变更涉及三个层次：

```
前端 UI               后端 Next.js 接口层       Python 视频服务
────────────────      ──────────────────────    ──────────────────
canStart("video")     readState() 返回           job_handler.py 逐镜头
  基于 file_counts  ← file_counts.image（磁盘）  检查图片 + 跳过逻辑
```

---

## 二、前端 canStart 判断（方案 C：真实磁盘来源）

### 2.1 问题

当前 `canStart("video")` 是纯同步的：

```typescript
if (step === "video") {
  return allSteps.image?.status === "completed"
      && allSteps.tts?.status === "completed";
}
```

`status` 来自 state.json，是持久化状态，**不反映实际磁盘文件数**。需要引入真实文件数量。

### 2.2 方案选型

**方案 C-1（推荐）：augment readState 响应，复用现有轮询通道**

将 `file_counts` 作为**计算字段**（不写入 state.json）附在 `/api/projects/{id}/state` 的响应里。`readState()` 在返回前扫描一次 `images/` 目录，得到文件数。

```
优点：
  ✓ 真实磁盘来源（每次轮询都扫一次）
  ✓ 复用已有的 5s SWR 轮询，无额外 roundtrip
  ✓ canStart 保持同步
  ✓ 不污染 state.json

缺点：
  - readState 响应结构变化（需兼容旧客户端，加为可选字段）
  - 每 5s 多一次目录扫描（images/ 通常 < 100 个文件，开销可忽略）
```

**方案 C-2：独立 `/api/projects/{id}/file-counts` 端点**

前端在 mount 时和每次 canStart 前单独请求：

```typescript
const canVideoStart = async () => {
  const { image } = await fetch(`/api/projects/${id}/file-counts`).then(r => r.json());
  return image > 0;
};
```

```
优点：
  ✓ 职责独立，不侵入 readState

缺点：
  - canStart 变为异步，UI 需要额外状态管理
  - 按钮 disabled/enabled 需要在请求返回后才能确定
  - 多一个 API 端点需要维护
```

**结论：采用方案 C-1**

C-1 在保持真实磁盘来源的同时，不引入异步复杂度，复用已有通道。C-2 在这个场景下得不偿失。

---

## 三、接口层变更

### 3.1 `ProjectState` 增加计算字段

**`apps/web/lib/project-store.ts`**

```typescript
// 新增，不持久化到 state.json
export interface FileCounts {
  image: number;   // images/ 目录中的有效图片文件数
  tts: number;     // audio/ 目录中的 .mp3 文件数
  video: number;   // clips/ 目录中的 .mp4 文件数
}

export interface ProjectState {
  project_id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepState>;
  file_counts?: FileCounts;   // ← 新增，计算字段，不写入 state.json
}
```

### 3.2 `readState()` 尾部扫描

在 `readState()` 返回前，扫描三个目录拿到文件数：

```typescript
// apps/web/lib/project-store.ts — readState() 末尾新增
async function computeFileCounts(id: string): Promise<FileCounts> {
  const dir = projectDir(id);
  const [imgFiles, audioFiles, clipFiles] = await Promise.all([
    fs.readdir(path.join(dir, "images")).catch(() => [] as string[]),
    fs.readdir(path.join(dir, "audio")).catch(() => [] as string[]),
    fs.readdir(path.join(dir, "clips")).catch(() => [] as string[]),
  ]);
  return {
    image: imgFiles.filter(f => /\.(png|jpg|webp)$/i.test(f)).length,
    tts:   audioFiles.filter(f => /\.mp3$/i.test(f)).length,
    video: clipFiles.filter(f => /\.mp4$/i.test(f)).length,
  };
}

// readState() 最后：
export async function readState(id: string): Promise<ProjectState> {
  // ... 现有逻辑 ...

  // 附加计算字段（不写入 state.json）
  state.file_counts = await computeFileCounts(id);
  return state;
}
```

> **注意**：`computeFileCounts` 在 `validateStepStatuses` 之后执行，不影响状态校验逻辑。`file_counts` 仅存在于内存中的返回值，不写入磁盘。

### 3.3 前端 `canStart("video")` 变更

**`apps/web/app/projects/[id]/page.tsx`**

```typescript
// state 类型已包含 file_counts（可选）
const imageCount = state?.file_counts?.image ?? 0;

function canStart(): boolean {
  // ...
  if (step === "video") {
    // 方案 C：基于真实磁盘文件数，不依赖 status 近似
    return imageCount > 0;
    // 注：TTS 依赖已移除（分镜视频时长使用 storyboard.duration）
  }
  // ...
}
```

`imageCount` 通过 `useProjectState` 的 SWR 轮询自动更新，无需额外 hook。

---

## 四、后端 video-service 变更

### 4.1 去掉 `audio_durations.json` 强依赖

**`services/video/job_handler.py`**

```python
# 删除：
dur_path = project_dir / "audio_durations.json"
if not dur_path.exists():
    raise FileNotFoundError("audio_durations.json not found — run tts-service first")
audio_durations = json.loads(dur_path.read_text(encoding="utf-8"))

# 替换为：
# 时长直接从分镜 JSON 读取，audio_durations.json 不再是前置条件
# 分镜视频时长 = storyboard shot.duration（Assembly 步骤负责音画同步）
```

新的时长函数：

```python
def _get_clip_duration(shot: dict) -> float:
    """分镜视频时长：使用分镜 JSON 声明的时长（Assembly 负责音画同步）。"""
    return float(shot.get("duration", 4.0))
```

### 4.2 逐镜头图片检查

新增图片查找函数：

```python
IMAGE_EXTENSIONS = ["png", "jpg", "webp"]

def find_shot_image(images_dir: Path, shot_id: str) -> Path | None:
    """查找分镜对应的图片文件（支持 png/jpg/webp）。"""
    for ext in IMAGE_EXTENSIONS:
        p = images_dir / f"{shot_id}.{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p
    return None
```

### 4.3 主循环重构

```python
async def run_generate_clips_job(job: JobRecord, project_id: str, config: dict, provider: VideoProvider):
    project_dir = Path(PROJECTS_BASE) / project_id

    storyboard = json.loads((project_dir / "storyboard.json").read_text(encoding="utf-8-sig"))
    shots = storyboard["shots"]

    images_dir = project_dir / "images"
    clips_dir  = project_dir / "clips"
    clips_dir.mkdir(exist_ok=True)

    cfg = {**DEFAULT_CONFIG, **config}
    job.total = len(shots)

    clips = []
    skipped_no_image = []   # 图片未就绪被跳过的 shot_id 列表

    for shot in shots:
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

        # ② 图片未就绪 → 跳过，记录
        image_path = find_shot_image(images_dir, shot_id)
        if image_path is None:
            skipped_no_image.append(shot_id)
            await job.emit_progress(
                shot_id=shot_id, done=job.done,
                message="Skipped (image not ready)", skipped=True, reason="image_not_ready",
            )
            continue

        # ③ 正常生成
        duration = _get_clip_duration(shot)
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
            clips.append({"shot_id": shot_id, "filename": f"{shot_id}.mp4", "duration": duration})
        except Exception as exc:
            logger.error(f"generate_clip failed for {shot_id}: {exc}\n{traceback.format_exc()}")
            await job.emit_error(str(exc), shot_id=shot_id, retryable=True)

    # ── 结束判断 ──────────────────────────────────────────────────────────────
    if skipped_no_image:
        # 部分完成：有分镜图片未就绪，主动以 stopped 状态结束
        await job.emit_partial_stop(
            skipped_shots=skipped_no_image,
            clips=clips,
            message=f"{len(skipped_no_image)} shot(s) skipped (image not ready): {skipped_no_image}",
        )
    else:
        await job.emit_complete({"clips": clips, "total": len(shots)})
```

### 4.4 `JobRecord.emit_partial_stop()`

**`services/shared/job_manager.py`** — 在 `JobRecord` 类中新增：

```python
async def emit_partial_stop(self, skipped_shots: list[str], clips: list[dict], message: str = ""):
    """
    Job 主动以 stopped 状态结束（区别于外部 stop() 调用）。
    用于「有分镜因条件未满足被跳过」的场景。
    """
    self.status = JobStatus.CANCELLED   # 复用 CANCELLED（对应前端 stopped 状态）
    self._touch()
    await self._broadcast("stopped", {
        "message": message,
        "done": self.done,
        "total": self.total,
        "skipped_shots": skipped_shots,
        "clips": clips,
    })
    await self._broadcast("__done__", {})
```

> **说明**：`JobStatus.CANCELLED` 在前端映射为 `stopped` 状态（通过 `events/route.ts` 监听 `stopped` SSE 事件后调用 `updateStep(..., { status: "stopped" })`）。此处复用该映射，不需要新增状态枚举。

---

## 五、数据流时序

```
用户点击「开始执行」视频步骤
  │
  ├─ SWR state 包含 file_counts.image = 5（已有 5 张图）
  ├─ canStart("video") = true（5 > 0）
  │
  ↓ POST /api/pipeline/{id}/video/start
  ↓ → POST http://video-service:8004/jobs
  ↓ ← job_id: "abc123"
  ↓ → updateStep("video", { status: "in_progress", job_id })
  │
  ↓ GET /api/pipeline/{id}/video/events（SSE）
  │
  ├─ E01_001: image 存在 → 生成视频 → emit progress ✓
  ├─ E01_002: image 存在 → 生成视频 → emit progress ✓
  ├─ E01_003: image 不存在 → 跳过 → emit progress (skipped, reason=image_not_ready)
  ├─ ...
  │
  ├─ [若所有 image 都就绪]
  │     └─ emit complete → events/route.ts → updateStep("video", "completed")
  │
  └─ [若有 image 未就绪]
        └─ emit stopped → events/route.ts → updateStep("video", "stopped")
           → 前端显示「重新开始」
           → 用户图片全部完成后点击重新开始 → 补充生成剩余片段
```

---

## 六、`events/route.ts` 变更分析

**无需修改**。当前代码已处理 `stopped` 事件：

```typescript
} else if (event === "stopped") {
  await updateStep(projectId, stepName, { status: "stopped" });
  done = true;
}
```

`emit_partial_stop` 发出的也是 `stopped` 事件，逻辑完全兼容。

---

## 七、`validateStepStatuses` 影响分析

当前 `validateStepStatuses` 在每次 `readState` 时对 video 步骤的校验逻辑：

```typescript
case "video":
  actualCount = (result.data as VideoResult).clips?.length ?? 0;
// expectedStatus: actualCount >= shotCount ? "completed" : "stopped"
```

**无需修改**。逻辑仍然正确：
- 视频全部完成 → `completed`
- 视频部分完成（因图片未就绪被跳过）→ `stopped`
- 视频 0 个 → `pending`（回退）

---

## 八、变更文件汇总

| 文件 | 变更内容 | 行数估计 |
|---|---|---|
| `services/shared/job_manager.py` | 新增 `JobRecord.emit_partial_stop()` | +15 行 |
| `services/video/job_handler.py` | 去掉 audio_durations；新增图片检查；主循环重构 | 改动 ~40 行 |
| `apps/web/lib/project-store.ts` | 新增 `FileCounts` 接口；`computeFileCounts()`；`readState` 末尾附加 | +25 行 |
| `apps/web/app/projects/[id]/page.tsx` | `canStart("video")` 条件改为 `imageCount > 0` | 改动 ~5 行 |
| `docs/technical/design/05-service-video.md` | 更新前置条件描述 | ~10 行 |

---

## 九、风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| `computeFileCounts` 每 5s 扫描目录 | CPU/IO 轻微增加 | 三次 `readdir` 并行，images/ < 200 文件，可忽略 |
| 视频时长使用 `duration` 字段而非实际音频时长 | 视频片段时长与对白时长可能有误差 | Assembly 步骤负责对齐，这是设计决策而非 bug |
| `emit_partial_stop` 复用 CANCELLED 状态 | 无语义问题（前端统一映射为 stopped） | 可在后续 sprint 引入 PARTIAL_STOPPED 枚举，当前兼容 |
| 视频步骤进入 stopped 后用户需手动重启 | 用户操作增加一步 | 有「重新开始」按钮，断点续传已支持；属于已接受的设计取舍 |

---

*技术文档版本：v1.0（待评审，评审通过后开发）*
