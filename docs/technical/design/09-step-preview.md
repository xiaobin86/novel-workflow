# 09 — 步骤结果预览设计

> **文档编号**：09  
> **关联文档**：08-step-lifecycle-control.md（生命周期控制）、07-webui-design.md（Web UI 设计）、01-services-overview.md（服务层设计）  
> **目标**：Pipeline 每个步骤执行完成后（及执行过程中），在当前步骤卡片下方展示该步骤生成的产物预览

---

## 1. 需求背景

现有 Pipeline 的步骤卡片在 `completed` 状态下仅展示文本提示（如"分镜已生成"、"图片已生成"），用户无法直观查看步骤产物：

- **Storyboard 步骤**：无法查看生成的分镜列表、每镜的动作/台词
- **Image 步骤**：无法预览生成的图片，只能盲猜是否成功
- **TTS 步骤**：无法试听音频效果
- **Video 步骤**：无法预览视频片段
- **Assembly 步骤**：无法播放最终视频

此外，SSE `complete` 事件携带的 `result` 数据（文件列表、路径等）在事件流结束后即丢失——`state.json` 不保存这些数据，导致页面刷新后 UI 无法还原产物列表。

**典型场景**：
1. 用户生成 10 张分镜图片后，想快速浏览每张图的质量 → 需要在 Image 步骤卡片下方看到图片网格
2. TTS 生成完成后，想试听某句台词的语音效果 → 需要音频播放器
3. Video 生成完成后，想检查某个片段的画面 → 需要视频播放器
4. 刷新页面后，已完成的步骤仍能展示产物 → 需要持久化产物元数据

---

## 2. 设计目标

1. **产物可见性**：每个步骤完成后，在其卡片下方渲染该步骤的产物预览
2. **实时反馈**：步骤执行过程中，每生成一个产物（如一张图、一段音频），立即追加到预览区域
3. **状态持久化**：产物元数据持久化到 `state.json`，刷新页面后仍可展示
4. **复用现有能力**：复用已有的 `/api/projects/{id}/files/{path}` 文件服务，不新增文件 serving 逻辑
5. **零后端侵入**：仅修改 SSE 代理持久化逻辑，各服务 handler 无需改动

---

## 3. 数据模型扩展

### 3.1 StepState 增加 `result` 字段

当前 `StepState` 仅追踪状态机信息：

```typescript
// 当前（08 文档之后）
export interface StepState {
  status: StepStatus;
  job_id: string | null;
  updated_at: string;
}
```

扩展后，增加 `result` 字段存储 `emit_complete` 的 payload：

```typescript
// 扩展后
export interface StepState {
  status: StepStatus;
  job_id: string | null;
  updated_at: string;
  result?: StepResult | null;  // 【新增】步骤完成产物元数据
}

// 各步骤的产物数据结构（与 emit_complete payload 对齐）
export type StepResult =
  | StoryboardResult
  | ImageResult
  | TTSResult
  | VideoResult
  | AssemblyResult;

export interface StoryboardResult {
  shot_count: number;
  storyboard_path: string;
}

export interface ImageResult {
  images: { shot_id: string; filename: string }[];
  total: number;
}

export interface TTSResult {
  audio_files: string[];
  total_tracks: number;
}

export interface VideoResult {
  clips: { shot_id: string; filename: string; duration: number }[];
  total: number;
}

export interface AssemblyResult {
  video_path: string;
  srt_path: string;
  duration: number;
}
```

### 3.2 持久化策略

当 SSE `complete` 事件到达时，`events/route.ts` 代理不仅更新 `status: "completed"`，还将 `event.result` 写入 `state.json`：

```typescript
// apps/web/app/api/pipeline/[id]/[step]/events/route.ts
if (event === "complete") {
  const result = parsed.result ?? null;
  await updateStep(projectId, stepName, { 
    status: "completed",
    result  // 【新增】持久化产物元数据
  });
  done = true;
}
```

### 3.3 实时追加策略（执行中预览）

步骤执行过程中，SSE `progress` 事件已携带足够信息构建实时预览：

- `progress` 事件字段：`shot_id`, `done`, `total`, `message`, `skipped`, `phase`, `track`, `filename`
- 前端在 `useStepProgress` 中维护一个本地 `artifacts` 数组，每收到一个 `progress` 事件就追加一个产物条目
- 步骤完成后，用 `state.steps[step].result` 替换本地数组（实现持久化对齐）

```typescript
// useStepProgress.ts 扩展
export interface ProgressState {
  done: number;
  total: number;
  message: string;
  isPaused: boolean;
  isStopped: boolean;
  artifacts: ProgressArtifact[];  // 【新增】实时产物列表
}

export interface ProgressArtifact {
  shot_id?: string;
  type: "image" | "audio" | "video" | "text";
  filename?: string;
  track?: string;  // "action" | "dialogue" for TTS
  skipped?: boolean;
}
```

---

## 4. 后端变更

### 4.1 SSE 代理路由（events/route.ts）

修改 `apps/web/app/api/pipeline/[id]/[step]/events/route.ts`：

1. **`complete` 事件处理**：解析 `result` 并传入 `updateStep`
2. **`error` 事件处理**：清空 `result`（若之前曾完成过，避免展示过期产物）

```typescript
// 变更片段
if (event === "complete") {
  const result = parsed.result ?? null;
  await updateStep(projectId, stepName, { 
    status: "completed", 
    result 
  });
  await _writeStateAtomic(projectId, stepName, state); // 现有逻辑
  done = true;
}

if (event === "error") {
  await updateStep(projectId, stepName, { 
    status: "failed",
    result: null  // 【新增】失败时清空产物
  });
  done = true;
}
```

### 4.2 无需变更的服务端代码

- 各服务的 `emit_complete` 已在 `services/shared/job_manager.py` 中实现，payload 结构正确
- 各服务的 `job_handler.py` 输出路径和文件命名已规范
- **无需修改任何 Python 代码**

---

## 5. 前端架构

### 5.1 组件层次

```
ProjectPage (page.tsx)
└── StepCard (map STEP_ORDER)
    ├── StepHeader (icon + title + status badge)
    ├── StepContent (status text + controls)
    │   └── StepArtifacts 【新增】产物预览区域
    │       ├── StoryboardArtifacts
    │       ├── ImageArtifacts
    │       ├── TTSArtifacts
    │       ├── VideoArtifacts
    │       └── AssemblyArtifacts
    └── StepActions (start/pause/resume/stop buttons)
```

### 5.2 StepArtifacts 组件设计

```typescript
// apps/web/components/step-artifacts.tsx
"use client";

import { useEffect, useState } from "react";
import { StepName, StepResult, StepState } from "@/lib/project-store";

interface StepArtifactsProps {
  step: StepName;
  projectId: string;
  stepState: StepState;
  progressArtifacts?: ProgressArtifact[]; // 来自 useStepProgress 的实时数据
}

export function StepArtifacts({ step, projectId, stepState, progressArtifacts }: StepArtifactsProps) {
  // 优先使用持久化的 result，回退到实时 progress 数据
  const result = stepState.result;
  
  if (!result && !progressArtifacts?.length) return null;

  return (
    <div className="mt-4 pt-4 border-t">
      {step === "storyboard" && <StoryboardArtifacts projectId={projectId} result={result as StoryboardResult} />}
      {step === "image" && <ImageArtifacts projectId={projectId} result={result as ImageResult} progressArtifacts={progressArtifacts} />}
      {step === "tts" && <TTSArtifacts projectId={projectId} result={result as TTSResult} progressArtifacts={progressArtifacts} />}
      {step === "video" && <VideoArtifacts projectId={projectId} result={result as VideoResult} progressArtifacts={progressArtifacts} />}
      {step === "assembly" && <AssemblyArtifacts projectId={projectId} result={result as AssemblyResult} />}
    </div>
  );
}
```

### 5.3 各步骤预览子组件

#### StoryboardArtifacts — 分镜列表

```typescript
function StoryboardArtifacts({ projectId, result }: { projectId: string; result?: StoryboardResult }) {
  const [shots, setShots] = useState<any[]>([]);
  
  useEffect(() => {
    fetch(`/api/projects/${projectId}/files/storyboard.json`)
      .then(r => r.json())
      .then(data => setShots(data.shots || []));
  }, [projectId]);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700">分镜列表 ({shots.length})</h4>
      <div className="max-h-64 overflow-y-auto space-y-2">
        {shots.map((shot) => (
          <div key={shot.shot_id} className="text-xs bg-gray-50 rounded p-2">
            <div className="flex justify-between">
              <span className="font-semibold">{shot.shot_id}</span>
              <span className="text-gray-500">{shot.shot_type} · {shot.duration}s</span>
            </div>
            <div className="mt-1 text-gray-600">{shot.action}</div>
            {shot.dialogue && <div className="mt-1 text-blue-600 italic">"{shot.dialogue}"</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### ImageArtifacts — 图片网格

```typescript
function ImageArtifacts({ projectId, result, progressArtifacts }: ImageArtifactsProps) {
  // 若 result 存在，使用 result.images；否则用 progressArtifacts 构建图片列表
  const images = result?.images ?? progressArtifacts?.map(a => ({ shot_id: a.shot_id!, filename: a.filename! })) ?? [];

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700">生成图片 ({images.length})</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {images.map((img) => (
          <div key={img.shot_id} className="relative aspect-video bg-gray-100 rounded overflow-hidden">
            <img 
              src={`/api/projects/${projectId}/files/images/${img.filename}`}
              alt={img.shot_id}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1 rounded">
              {img.shot_id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### TTSArtifacts — 音频播放器列表

```typescript
function TTSArtifacts({ projectId, result, progressArtifacts }: TTSArtifactsProps) {
  // TTS 产物需要从 storyboard.json 推断 shot_id → track 映射
  // 或使用 progressArtifacts 中的 track 字段
  const audioFiles = result?.audio_files ?? [];

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700">音频文件 ({audioFiles.length})</h4>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {audioFiles.map((filename) => {
          const track = filename.includes("_dialogue") ? "台词" : "旁白";
          const shotId = filename.replace(/_(action|dialogue)\.wav$/, "");
          return (
            <div key={filename} className="bg-gray-50 rounded p-2">
              <div className="text-xs text-gray-600 mb-1">{shotId} · {track}</div>
              <audio 
                controls 
                className="w-full h-8"
                src={`/api/projects/${projectId}/files/audio/${filename}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

#### VideoArtifacts — 视频片段网格

```typescript
function VideoArtifacts({ projectId, result, progressArtifacts }: VideoArtifactsProps) {
  const clips = result?.clips ?? progressArtifacts?.map(a => ({ shot_id: a.shot_id!, filename: a.filename!, duration: 0 })) ?? [];

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700">视频片段 ({clips.length})</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {clips.map((clip) => (
          <div key={clip.shot_id} className="bg-gray-50 rounded p-2">
            <video 
              controls 
              className="w-full rounded"
              src={`/api/projects/${projectId}/files/clips/${clip.filename}`}
              preload="metadata"
            />
            <div className="text-xs text-gray-600 mt-1">
              {clip.shot_id} · {clip.duration?.toFixed(1)}s
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### AssemblyArtifacts — 最终视频播放器

```typescript
function AssemblyArtifacts({ projectId, result }: { projectId: string; result?: AssemblyResult }) {
  if (!result) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-gray-700">最终成片 ({result.duration}s)</h4>
      <video 
        controls 
        className="w-full rounded-lg"
        src={`/api/projects/${projectId}/files/output/final.mp4`}
        poster={`/api/projects/${projectId}/files/images/E01_001.png`} // 可选首帧海报
      />
      <div className="flex gap-2">
        <a href={`/api/projects/${projectId}/files/output/final.mp4?download=1`}>
          <Button size="sm" variant="outline">下载 MP4</Button>
        </a>
        <a href={`/api/projects/${projectId}/files/output/final.srt?download=1`}>
          <Button size="sm" variant="outline">下载 SRT</Button>
        </a>
      </div>
    </div>
  );
}
```

---

## 6. 文件访问策略

### 6.1 现有能力复用

项目已具备通用文件 serving API：

```typescript
// GET /api/projects/{id}/files/{...path}
// Content-Type 自动推断：.png → image/png, .mp4 → video/mp4, .wav → audio/wav
```

所有产物预览均通过此 API 访问，无需新增路由：

| 产物 | 访问路径 |
|------|----------|
| storyboard.json | `/api/projects/{id}/files/storyboard.json` |
| 分镜图片 | `/api/projects/{id}/files/images/{shot_id}.png` |
| TTS 音频 | `/api/projects/{id}/files/audio/{shot_id}_action.wav` |
| 视频片段 | `/api/projects/{id}/files/clips/{shot_id}.mp4` |
| 最终视频 | `/api/projects/{id}/files/output/final.mp4` |
| 字幕文件 | `/api/projects/{id}/files/output/final.srt` |

### 6.2 Storyboard 数据加载

StoryboardArtifacts 需要读取 `storyboard.json` 获取 shot 列表。由于 `storyboard.json` 在 storyboard 步骤完成后即存在，且 image/tts/video 步骤均依赖它，因此：

- **Storyboard 步骤**：直接从 `result.storyboard_path` 或默认路径读取
- **后续步骤**：`storyboard.json` 已存在于项目目录，可直接 fetch

---

## 7. UI 设计细节

### 7.1 展示时机

| 步骤状态 | 是否展示预览 | 说明 |
|----------|-------------|------|
| `pending` | 否 | 无产物 |
| `in_progress` | **是** | 实时展示 progressArtifacts（每生成一个追加一个） |
| `paused` | 是 | 展示已生成的产物（从 progressArtifacts 或 result） |
| `stopped` | 是 | 展示已生成的产物（部分完成） |
| `completed` | 是 | 展示完整产物（从 state.result） |
| `failed` | 否 | 失败时清空产物，避免展示不完整数据 |

### 7.2 布局约束

- **最大高度**：预览区域设置 `max-h-96 overflow-y-auto`，避免长列表撑开页面
- **响应式**：图片/视频网格在移动端 1-2 列，桌面端 3-4 列
- **懒加载**：`<img loading="lazy" />` 减少首屏加载压力
- **视频预加载**：`preload="metadata"` 仅加载元数据，不自动缓冲完整视频

### 7.3 空状态

若步骤完成但 `result` 为空（如老数据未持久化 result），展示提示：

```tsx
<div className="text-sm text-gray-500 italic">
  产物数据未持久化，请刷新页面或重新执行此步骤
</div>
```

---

## 8. 实现顺序

### Phase 1：数据层（必须先完成）
1. 扩展 `StepState` / `StepResult` 类型定义
2. 修改 `events/route.ts` 持久化 `result`
3. 扩展 `useStepProgress` 维护 `progressArtifacts` 数组

### Phase 2：展示层
4. 创建 `StepArtifacts` 主组件及 5 个子组件
5. 修改 `page.tsx` 的 `StepContent`，在下方插入 `<StepArtifacts />`
6. 为各步骤配置实时 artifact 生成逻辑（解析 progress 事件）

### Phase 3：验证
7. TypeScript 类型检查
8. ESLint 检查
9. 端到端测试：执行 pipeline，验证每步预览正确显示

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **大视频文件加载慢** | 最终视频可能数百 MB，直接 `<video src>` 会全量下载 | 视频标签使用 `preload="metadata"`；后续可扩展为分段加载 / 缩略图海报 |
| **大量图片加载压力** | 50+ 张分镜图片同时加载 | `loading="lazy"` + 分页/虚拟滚动（v2） |
| **state.json 膨胀** | `result` 字段存储文件列表，大项目可能达数十 KB | 仅存储元数据（文件名、shot_id），不存储文件内容；state.json 仍可控 |
| **刷新后产物丢失** | 老项目的 `state.json` 无 `result` 字段 |  graceful fallback：从 `storyboard.json` + 文件系统约定推断产物列表 |
| **并发修改冲突** | 用户同时操作多个步骤 | 各步骤状态独立，无共享锁问题 |

---

## 10. 未来扩展

1. **图片灯箱**：点击分镜图片放大查看，支持键盘导航
2. **视频拼接预览**：Assembly 步骤支持预览最终视频时叠加字幕
3. **产物下载打包**：一键下载某步骤全部产物为 ZIP
4. **产物对比**：重新执行步骤后，支持新旧产物并排对比
5. **缩略图生成**：为视频片段生成首帧缩略图，减少视频加载压力
