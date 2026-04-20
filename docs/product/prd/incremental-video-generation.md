# PRD：图片就绪即启动视频生成（逐镜头处理）

**状态**: ✅ 已确认（2026-04-20）  
**创建日期**: 2026-04-20  
**作者**: Sisyphus Agent  

---

## 一、背景

### 当前问题

Pipeline 当前的步骤顺序是严格串行的：

```
分镜生成 → 图片生成（全部完成）→ TTS（全部完成）→ 视频生成 → 合并
```

视频生成步骤的启动条件（`canStart("video")`）为：

```
image.status === "completed"  AND  tts.status === "completed"
```

**时间浪费**：以 32 个分镜为例，图片生成每张约 90 秒，全部完成约需 **48 分钟**。在此期间，视频生成处于完全空闲状态。视频服务（Wan2.1 GPU）和图片服务（FLUX.1 GPU）共用同一块 GPU，虽无法真正并行，但在图片逐张完成的过程中，视频服务可以立即处理已完成的分镜，而不必等待所有图片都就绪。

### 需求背景

只要某个分镜的图片已经生成，就应该允许为该分镜生成视频片段，而不必等待所有分镜图片都生成完毕。视频以「所有分镜视频都生成完毕」作为完成状态。

---

## 二、目标

1. **缩短用户等待时间**：视频生成和图片生成交替推进（GPU：图片生成完一个 → 切换视频生成该分镜 → 切换回图片生成下一个），整体 Pipeline 耗时显著下降
2. **去除 TTS 对视频的前置依赖**：分镜视频时长使用分镜 JSON 中的 `duration` 字段，不依赖 TTS 音频时长（音频同步由最终 Assembly 步骤处理）
3. **不改变最终产物质量**：生成的视频片段内容与当前方式一致

---

## 三、用户故事

> **As a** 使用 Pipeline 生成视频的用户  
> **I want** 只要有一张分镜图片生成完毕，就可以启动视频生成步骤，且 TTS 不影响视频启动  
> **So that** 图片、TTS、视频三个步骤可以同步推进，节省总体等待时间

---

## 四、功能描述

### 4.1 视频步骤启动条件变更

| | 当前 | 新 |
|---|---|---|
| 启动视频步骤的条件 | `image=completed` AND `tts=completed` | `images/` 目录中**至少有 1 个**图片文件 |
| 对 TTS 的依赖 | 强依赖（`tts=completed`） | **无依赖**（TTS 可并行或未开始） |

### 4.2 视频服务逐镜头处理逻辑

对每个分镜，判断其图片是否已存在：

```
对每个 shot（顺序遍历）：
  ├─ clips/{shot_id}.mp4 已存在 → 跳过（断点续传）
  ├─ images/{shot_id}.{png|jpg|webp} 已存在 → 生成视频片段
  └─ 图片不存在 → 跳过，emit skipped 事件，记录到 skipped_shots 列表
  
遍历结束后：
  ├─ skipped_shots 为空 → emit complete（全部完成）
  └─ skipped_shots 非空 → emit stopped（部分完成，等待图片就绪后重新触发）
```

**clip 时长计算**：直接使用分镜 JSON 中的 `duration` 字段（不再读取 `audio_durations.json`）

### 4.3 图片文件查找

图片支持多种扩展名，按以下顺序查找：

```python
IMAGE_EXTENSIONS = ["png", "jpg", "webp"]

def find_shot_image(images_dir: Path, shot_id: str) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        p = images_dir / f"{shot_id}.{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p
    return None
```

### 4.4 完成状态判定

| 情况 | 发出的 SSE 事件 | 最终步骤状态 |
|---|---|---|
| 所有分镜均有视频 | `complete` | `completed` |
| 有分镜图片不存在（被跳过） | `stopped`（带 skipped 列表） | `stopped` |
| 用户手动停止 | `stopped` | `stopped` |

`stopped` 状态的步骤可重新启动，视频服务会自动跳过已生成的片段，继续处理剩余的（此时图片通常已就绪）。

### 4.5 前端 canStart 逻辑变更

```typescript
// 当前
if (step === "video") {
  return allSteps.image?.status === "completed" 
      && allSteps.tts?.status === "completed";
}

// 新（需要一个新 API 或状态来告知「images/ 目录非空」）
if (step === "video") {
  return hasAnyImage;  // images/ 目录中至少有 1 个文件
}
```

> **实现注意**：当前 `stepState` 中没有"图片文件数量"这个字段，`canStart` 可通过以下方案之一实现：
> - 方案 A：在 `ProjectState` 里增加 `image_count` 等辅助字段（轻侵入）
> - 方案 B：image 步骤 `status=in_progress` OR `status=completed` 时允许启动（用状态近似，不读磁盘）
> - 方案 C：`canStart` 前发起一个轻量 API 请求查询图片数量
>
> 待技术方案讨论确认。

---

## 五、验收标准

| # | 场景 | 期望行为 |
|---|---|---|
| AC-1 | `images/` 非空，TTS 任意状态 | 「视频生成」按钮**可点击** |
| AC-2 | `images/` 为空 | 「视频生成」按钮**不可点击** |
| AC-3 | 视频服务运行中，某分镜图片存在 | 正常生成该分镜视频，进度事件推送 |
| AC-4 | 视频服务运行中，某分镜图片不存在 | 该分镜被跳过，emit skipped 事件 |
| AC-5 | 所有分镜均有视频 | 步骤状态变为 `completed` |
| AC-6 | 有分镜被跳过（图片未就绪） | 步骤状态变为 `stopped`，按钮变为「重新开始」 |
| AC-7 | 图片全部完成后，重新启动视频步骤 | 已有视频直接跳过，被跳过的分镜正常补充生成，最终 `completed` |
| AC-8 | 视频步骤使用时长 | 使用分镜 JSON 的 `duration` 字段，不读 `audio_durations.json` |
| AC-9 | TTS 未开始，视频可启动 | 正常生成，时长由 `duration` 决定 |

---

## 六、边界与非目标

### 边界（已确认）

- **跳过策略**：图片未就绪的分镜跳过，不在服务内部轮询等待。用户图片完成后重新触发视频步骤即可完成剩余片段
- **时长使用分镜声明值**：分镜视频时长 = `shot.duration`（来自 storyboard.json），不依赖 `audio_durations.json`
- **GPU 串行不变**：FLUX 和 Wan2.1 共用 GPU，本特性只是改变「什么时候可以启动视频步骤」，不改变 GPU 调度方式
- **Assembly 步骤不变**：最终合成视频的音画同步由 Assembly 步骤处理，不受本特性影响

### 非目标

- ❌ 图片与视频在同一 GPU 上真正并行（硬件限制）
- ❌ 视频服务内部轮询等待图片就绪
- ❌ 改变 Assembly 步骤的启动条件
- ❌ 图片生成步骤本身的任何变更

---

## 七、影响范围

| 模块 | 变更内容 | 复杂度 |
|---|---|---|
| `apps/web/app/projects/[id]/page.tsx` | `canStart("video")` 改为检查「images 目录非空」 | 小 |
| `apps/web/lib/project-store.ts` 或新 API | 提供「当前已有图片数量」信息供前端判断 | 中 |
| `services/video/job_handler.py` | 去掉 `audio_durations.json` 强依赖；逐镜头检查图片；图片不存在时跳过；最终判断是否全部完成 | 中 |
| `docs/technical/design/05-service-video.md` | 前置条件描述更新 | 小 |

---

*PRD 版本：v1.0（已与用户确认，可进入技术方案设计）*
