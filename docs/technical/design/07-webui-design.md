# 07 — Web UI 详细设计

**框架**：Next.js 15（App Router）  
**端口**：3000  
**职责**：编排 5 个后端服务、展示实时进度、管理项目生命周期  
**定位**：单用户本地工具，无需鉴权

---

## 1. 目录结构

```
apps/web/
├── app/
│   ├── layout.tsx                    # 根布局（主题、Toast Provider）
│   ├── page.tsx                      # 重定向 → /projects
│   ├── projects/
│   │   ├── page.tsx                  # 项目列表页
│   │   └── [id]/
│   │       ├── page.tsx              # 项目详情（流水线向导）
│   │       └── layout.tsx            # 项目布局（顶部项目名、返回按钮）
│   └── api/
│       ├── projects/
│       │   ├── route.ts              # GET /api/projects, POST /api/projects
│       │   └── [id]/
│       │       ├── route.ts          # GET, PATCH, DELETE /api/projects/[id]
│       │       ├── state/
│       │       │   └── route.ts      # GET /api/projects/[id]/state
│       │       └── files/
│       │           └── [...path]/
│       │               └── route.ts  # GET /api/projects/[id]/files/[...path]
│       └── pipeline/
│           └── [id]/
│               ├── [step]/
│               │   ├── start/
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/start
│               │   ├── pause/        # 【新增】
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/pause
│               │   ├── resume/       # 【新增】
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/resume
│               │   ├── stop/         # 【新增】
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/stop
│               │   ├── reset/        # 【新增】阶段级重新生成（清空产物+重置状态）
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/reset
│               │   ├── regenerate-item/ # 【新增】产物级重新生成（单个 shot）
│               │   │   └── route.ts  # POST /api/pipeline/[id]/[step]/regenerate-item
│               │   └── events/
│               │       └── route.ts  # GET /api/pipeline/[id]/[step]/events (SSE 代理)
│               └── unload-model/
│                   └── route.ts      # POST /api/pipeline/[id]/unload-model
├── components/
│   ├── project/
│   │   ├── ProjectCard.tsx
│   │   └── NewProjectDialog.tsx
│   ├── pipeline/
│   │   ├── PipelineWizard.tsx        # 整体向导容器
│   │   ├── StepCard.tsx              # 单步卡片（通用）
│   │   ├── AutoModeToggle.tsx        # 自动模式开关
│   │   └── steps/
│   │       ├── StoryboardStep.tsx    # 步骤1：分镜
│   │       ├── ImageStep.tsx         # 步骤2：图片
│   │       ├── TTSStep.tsx           # 步骤3：TTS
│   │       ├── VideoStep.tsx         # 步骤4：视频
│   │       └── AssemblyStep.tsx      # 步骤5：合并
│   ├── viewer/
│   │   ├── StoryboardViewer.tsx      # 分镜 JSON 展示
│   │   ├── ImageGrid.tsx             # 图片九宫格
│   │   ├── AudioList.tsx             # 音频播放列表
│   │   ├── VideoGrid.tsx             # 视频片段网格
│   │   └── FinalVideoPlayer.tsx      # 最终视频播放器
│   ├── step-artifacts.tsx            # 产物预览（StoryboardArtifacts/ImageArtifacts/TTSArtifacts/VideoArtifacts/AssemblyArtifacts）
│   ├── delete-project-dialog.tsx     # 删除项目确认弹窗
│   ├── confirm-dialog.tsx            # 通用确认弹窗（供重新生成等操作复用）
│   └── ui/                           # 基础 UI 组件（shadcn/ui）
├── hooks/
│   ├── useStepProgress.ts            # SSE 进度流
│   ├── useProjectState.ts            # SWR 项目状态
│   ├── useAutoMode.ts                # 自动模式状态
│   └── useStepControl.ts             # 【新增】步骤控制（暂停/恢复/停止）
├── lib/
│   ├── services.ts                   # 各服务端口/地址映射
│   ├── project-store.ts              # 项目 JSON 文件读写（服务端）
│   └── pipeline-orchestrator.ts     # 服务调用封装（服务端）
└── public/
    └── placeholder-shot.png          # 占位图
```

---

## 2. 页面设计

### 2.1 项目列表页（`/projects`）

**布局：**
```
┌─────────────────────────────────────────────────────┐
│  Novel Workflow                          [+ 新建项目] │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 斗破苍穹-E01  │  │ 斗罗大陆-E01  │  │  + 新建项目   │ │
│  │ 视频生成中    │  │ 已完成        │  │              │ │
│  │ ████░░░  4/5  │  │ ✓ 5/5        │  │              │ │
│  │ 2024-01-15   │  │ 2024-01-10   │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────┘
```

**ProjectCard 状态指示器：**

| 状态 | 样式 |
|------|------|
| 全部 pending | 灰色，"未开始" |
| 有步骤 in_progress | 蓝色脉冲，"进行中 N/5" |
| 有步骤 failed | 红色，"失败" |
| 全部 completed | 绿色，"✓ 已完成" |

---

### 2.2 项目详情页（`/projects/[id]`）

**整体布局（竖向步骤条）：**

```
┌──────────────────────────────────────────────────────┐
│ ← 项目列表   斗破苍穹-E01              [自动模式 ○] │
├──────────────────────────────────────────────────────┤
│  步骤条（左）              内容区（右）               │
│                                                       │
│  ① 分镜生成  ✓           ┌──────────────────────┐   │
│  |                        │  [步骤内容/进度]      │   │
│  ② 图片生成  ✓            │                      │   │
│  |                        │                      │   │
│  ③ TTS 生成  ✓           │                      │   │
│  |                        │                      │   │
│  ④ 视频生成  进行中...    │  E01_004 生成中...    │   │
│  |                        │  ████████░░  4/10    │   │
│  ⑤ 素材合并  待执行       └──────────────────────┘   │
│                                                       │
└──────────────────────────────────────────────────────┘
```

**步骤条状态图标：**

| 状态 | 图标 | 颜色 |
|------|------|------|
| pending | ○ | 灰色 |
| in_progress | ◌ (旋转) | 蓝色 |
| paused | ⏸ | 琥珀色 |
| stopped | ■ | 橙色 |
| completed | ✓ | 绿色 |
| failed | ✗ | 红色 |

---

## 3. API Routes 设计

### 3.1 项目管理

#### `GET /api/projects`
```typescript
// 响应
type Response = {
  projects: {
    id: string;
    title: string;
    episode: string;
    created_at: string;
    pipeline_status: StepStatus[];  // 5步状态摘要
  }[]
}
```

#### `POST /api/projects`
```typescript
// 请求体
type Request = {
  title: string;        // 小说名
  episode: string;      // 集号，如 "E01"
  text?: string;        // 小说文本（可选，若提供则写入 input.txt）
}
// 响应：201 { id, title, episode }
// 副作用：创建 projects/{id}/ 目录 + state.json + input.txt（若有文本）
```

#### `GET /api/projects/[id]/state`
```typescript
// 响应：当前 ProjectState（所有步骤的 status + last_updated_at）
type Response = ProjectState
```

#### `PATCH /api/projects/[id]`
```typescript
// 请求体：部分更新（title、episode、input.txt 内容）
type Request = { title?: string; episode?: string; text?: string }
```

---

### 3.2 流水线编排

#### `POST /api/pipeline/[id]/[step]/start`

编排逻辑由此路由处理（服务端），包括：
1. 调用对应 Docker 服务的 `POST /jobs`
2. 将返回的 `job_id` 写入 `state.json`
3. 更新该步骤状态为 `in_progress`
4. 返回 `{ job_id }`

```typescript
// step: "storyboard" | "image" | "tts" | "video" | "assembly"

// 特殊处理：video 步骤开始前调用 POST /api/pipeline/[id]/unload-model
// （image-service 模型卸载，释放 GPU）

// 请求体（可选，支持步骤直入时上传素材）
type Request = {
  config?: Record<string, unknown>;  // 透传给服务的配置参数
  upload_mode?: boolean;             // 是否是直接上传模式
}
// 响应：202 { job_id, step }
```

**各步骤 config 默认值（服务端硬编码）：**

```typescript
const STEP_CONFIGS = {
  image: { width: 768, height: 768, num_inference_steps: 28, guidance_scale: 3.5 },
  video: { width: 832, height: 480, num_frames: 65, num_inference_steps: 30 },
  assembly: { action_volume: 1.0, dialogue_volume: 1.0 },
} as const;
```

#### `GET /api/pipeline/[id]/[step]/events`（SSE 代理）

从对应 Docker 服务的 `GET /jobs/{job_id}/events` 读取 SSE，透传到浏览器，并在 `complete` / `error` 时更新 `state.json`。

```typescript
// 实现
export async function GET(req: Request, { params }) {
  const { id: projectId, step } = params;
  const state = await readState(projectId);
  const jobId = state.steps[step].job_id;
  const serviceUrl = SERVICE_URLS[step];

  const upstream = await fetch(`${serviceUrl}/jobs/${jobId}/events`);
  
  // 转发 SSE 流
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // 逐行读取 upstream，写入 writer
  // complete 时：更新 state.json（status=completed）
  // error 时：更新 state.json（status=failed）

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

#### `POST /api/pipeline/[id]/[step]/pause`（【新增】暂停步骤）

```typescript
// 调用对应服务的 POST /jobs/{job_id}/pause
// 更新 state.json status = "paused"
// 响应：200 { status: "paused" }
```

#### `POST /api/pipeline/[id]/[step]/resume`（【新增】恢复步骤）

```typescript
// 调用对应服务的 POST /jobs/{job_id}/resume
// 更新 state.json status = "in_progress"
// 响应：200 { status: "in_progress" }
```

#### `POST /api/pipeline/[id]/[step]/stop`（【新增】停止步骤）

```typescript
// 调用对应服务的 POST /jobs/{job_id}/stop
// 更新 state.json status = "stopped"
// 响应：200 { status: "stopped" }
```

#### `POST /api/pipeline/[id]/unload-model`

```typescript
// 调用 image-service POST /model/unload
// 等待响应后返回 200
// Next.js 在启动 video-service 前调用此端点
```

---

## 4. 组件详细设计

### 4.1 PipelineWizard

**职责**：读取 `ProjectState`，决定当前激活步骤，协调各步骤的展示与执行。

```typescript
interface PipelineWizardProps {
  projectId: string;
}

// 内部状态
const [activeStep, setActiveStep] = useState<StepName>("storyboard");
const [autoMode, setAutoMode] = useAutoMode(projectId);
const { state, mutate } = useProjectState(projectId);

// 核心逻辑：当一个步骤 complete 时
const handleStepComplete = async (step: StepName) => {
  await mutate();  // 刷新 state
  if (autoMode) {
    const next = NEXT_STEP[step];
    if (next) startStep(next);  // 自动启动下一步
  }
  // 非自动模式：等待用户确认（步骤卡片显示"确认并继续"按钮）
};
```

**步骤顺序与并行规则：**

```
storyboard → image & tts（并行）→ video → assembly
```

image 和 tts 可并行启动（image 用 GPU，tts 用 CPU），但 video 必须等 image 和 tts 均完成后才能启动。

---

### 4.2 StepCard（通用步骤卡片）

```typescript
interface StepCardProps {
  step: StepName;
  status: "pending" | "in_progress" | "paused" | "stopped" | "completed" | "failed";
  isActive: boolean;
  onStart: () => void;
  onPause: () => void;     // 【新增】暂停
  onResume: () => void;    // 【新增】恢复
  onStop: () => void;      // 【新增】停止
  onRestart: () => void;   // 【新增】重新开始（stopped 状态）
  onConfirm: () => void;  // 仅在 completed 且非 auto-mode 时显示
  children: React.ReactNode;  // 步骤内容区
}
```

**卡片布局：**

```
┌────────────────────────────────────────────────────┐
│ ② 图片生成                              ✓ 已完成   │
├────────────────────────────────────────────────────┤
│  [步骤内容：进度条/预览/播放器]                     │
├────────────────────────────────────────────────────┤
│                              [确认并继续下一步 →]   │
└────────────────────────────────────────────────────┘
```

状态控制底部操作区显示：
- `pending`：`[开始执行]` 按钮（或灰色"等待前序步骤"）
- `in_progress`：进度条 + `[⏸ 暂停] [■ 停止]` 按钮（【新增】）
- `paused`：进度条（保留） + `[▶ 继续] [■ 停止]` 按钮（【新增】）
- `stopped`：已停止提示 + `[重新开始]` 按钮（【新增】，利用断点续传）
- `completed` + 非 auto-mode：`[确认并继续 →]` 按钮
- `completed` + auto-mode：无按钮（自动推进）
- `failed`：错误信息 + `[重试]` 按钮

---

### 4.3 AutoModeToggle

```typescript
// 存储在 localStorage，key: `auto-mode-${projectId}`
function useAutoMode(projectId: string) {
  const [enabled, setEnabled] = useLocalStorage(`auto-mode-${projectId}`, false);
  return [enabled, setEnabled] as const;
}
```

**UI：**

```
[自动模式]  ○────●  开启时跳过每步确认，自动执行全流程
```

---

### 4.4 useStepProgress（SSE Hook）

```typescript
interface ProgressEvent {
  shot_id?: string;
  done: number;
  total: number;
  message?: string;
  skipped?: boolean;
  phase?: string;         // storyboard 专用
  track?: string;         // tts 专用（"action" | "dialogue"）
}

interface StepProgress {
  events: ProgressEvent[];
  lastEvent: ProgressEvent | null;
  isComplete: boolean;
  isPaused: boolean;       // 【新增】当前是否处于暂停状态
  isStopped: boolean;      // 【新增】当前是否被停止
  error: string | null;
  percent: number;        // done/total * 100
}

function useStepProgress(projectId: string, step: StepName, active: boolean): StepProgress {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isPaused, setIsPaused] = useState(false);      // 【新增】
  const [isStopped, setIsStopped] = useState(false);    // 【新增】
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const es = new EventSource(`/api/pipeline/${projectId}/${step}/events`);
    
    es.addEventListener("progress", (e) => {
      setEvents(prev => [...prev, JSON.parse(e.data)]);
    });
    es.addEventListener("paused", () => {               // 【新增】
      setIsPaused(true);
    });
    es.addEventListener("resumed", () => {              // 【新增】
      setIsPaused(false);
    });
    es.addEventListener("stopped", () => {              // 【新增】
      setIsStopped(true);
      setIsComplete(true);
    });
    es.addEventListener("complete", () => {
      setIsComplete(true);
      es.close();
    });
    es.addEventListener("error", (e) => {
      setError(JSON.parse(e.data).message);
    });

    return () => es.close();
  }, [projectId, step, active]);

  const lastEvent = events[events.length - 1] ?? null;
  const percent = lastEvent ? Math.round((lastEvent.done / lastEvent.total) * 100) : 0;

  return { events, lastEvent, isComplete, isPaused, isStopped, error, percent };
}
```

---

### 4.5 各步骤内容组件

#### StoryboardStep

```
┌──────────────────────────────────────────────────────┐
│ 输入文本                                              │
│ ┌─────────────────────────────────────────────────┐  │
│ │ 萧炎缓缓翻开泛黄的古籍...                         │  │
│ │ （textarea，可编辑）                              │  │
│ └─────────────────────────────────────────────────┘  │
│                                           [生成分镜]  │
├──────────────────────────────────────────────────────┤
│ 生成状态（in_progress 时）                            │
│ ⊙ 正在调用 Kimi API...                               │
│ ⊙ 解析分镜 JSON，共 10 个镜头                        │
├──────────────────────────────────────────────────────┤
│ 分镜预览（completed 时）                              │
│ ┌──────┬─────────────────────────────────────────┐  │
│ │E01_001│ 【远景】镜头缓慢推进...                  │  │
│ │      │ 旁白：萧炎站在悬崖边...                  │  │
│ │      │ 台词：（无）                             │  │
│ └──────┴─────────────────────────────────────────┘  │
│ ┌──────┬─────────────────────────────────────────┐  │
│ │E01_002│ 【特写】人物面部表情...                  │  │
│ └──────┴─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**StoryboardViewer 组件**：展示 `storyboard.json` 中的 shots 列表，每行显示 `shot_id`、`shot_type`、`action`（旁白）、`dialogue`（台词，可选）。

---

#### ImageStep

```
┌──────────────────────────────────────────────────────┐
│ 图片生成进度（in_progress 时）                        │
│ ████████████░░░░░░░░  6/10                           │
│ 当前：E01_006 生成中...（约 90 秒/张）               │
├──────────────────────────────────────────────────────┤
│ 图片预览（completed 或 in_progress 时已生成的）       │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
│ │E01_001│ │E01_002│ │E01_003│ │ ⏳   │                 │
│ └──────┘ └──────┘ └──────┘ └──────┘                 │
│ ┌──────┐ ┌──────┐                                    │
│ │E01_004│ │ ⏳   │                                    │
│ └──────┘ └──────┘                                    │
└──────────────────────────────────────────────────────┘
```

**ImageGrid 组件**：
- 图片路径：`/projects/{project_id}/images/{shot_id}.png`（通过 Next.js static file 或 API 代理）
- 已生成：显示实际图片，悬停显示 `shot_id` 和 `image_prompt`（tooltip）
- 未生成：显示灰色占位框 + 旋转图标

---

#### TTSStep

```
┌──────────────────────────────────────────────────────┐
│ TTS 生成进度（in_progress 时）                        │
│ ████████░░░░  8/18 轨道（旁白+台词各计1条）          │
│ 当前：E01_004 dialogue 生成中...                     │
├──────────────────────────────────────────────────────┤
│ 音频列表（completed 或 in_progress 时）               │
│                                                       │
│ E01_001  旁白  ▶ [─────────────────] 5.3s            │
│          台词  ▶ [───────────] 3.1s                  │
│ E01_002  旁白  ▶ [──────────────────] 6.8s           │
│          台词  —（无台词）                            │
│ ...                                                   │
└──────────────────────────────────────────────────────┘
```

**AudioList 组件**：
- 音频路径：`/api/projects/{project_id}/files/audio/{shot_id}_{track}.mp3`
- 使用 HTML5 `<audio>` 元素，带播放控制
- 已跳过的条目标注"已存在"徽标

**与 ImageStep 并行说明：** TTS 和图片生成可同时启动（UI 上两个卡片同时显示 in_progress 状态）。

---

#### VideoStep

```
┌──────────────────────────────────────────────────────┐
│ 视频生成进度（in_progress 时）                        │
│ ████░░░░░░░░░░  2/10                                 │
│ 当前：E01_003 生成中...（约 5 分钟/片段）            │
│ 预计剩余：~40 分钟                                   │
├──────────────────────────────────────────────────────┤
│ 视频片段预览（completed 或部分完成时）                │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
│ │▶E01_01│ │▶E01_02│ │ ⏳   │ │ ⏳   │                 │
│ └──────┘ └──────┘ └──────┘ └──────┘                 │
└──────────────────────────────────────────────────────┘
```

**VideoGrid 组件**：
- 视频路径：`/projects/{project_id}/clips/{shot_id}.mp4`
- 使用 HTML5 `<video>` 元素，悬停时播放预览（短片段自动循环）
- 预计剩余时间：`(total - done) * 300 / 60` 分钟

---

#### AssemblyStep

```
┌──────────────────────────────────────────────────────┐
│ 合并进度（in_progress 时）                            │
│ ⊙ 检查素材完整性，共 10 个 shot                      │
│ ⊙ 冻结帧补齐（3/10）                                 │
│ ⊙ 拼接视频片段...                                   │
├──────────────────────────────────────────────────────┤
│ 最终视频（completed 时）                              │
│ ┌─────────────────────────────────────────────────┐  │
│ │                                                 │  │
│ │  ▶  斗破苍穹 E01 - 最终视频（68.5 秒）          │  │
│ │                                                 │  │
│ └─────────────────────────────────────────────────┘  │
│ [下载 MP4]  [下载 SRT]                               │
└──────────────────────────────────────────────────────┘
```

**FinalVideoPlayer 组件**：
- 视频路径：`/projects/{project_id}/output/final.mp4`
- 字幕路径：`/projects/{project_id}/output/final.srt`
- `<video>` + `<track kind="subtitles">` 内嵌字幕
- 下载链接通过 API 路由提供（设置 `Content-Disposition: attachment`）

---

## 5. 步骤直入（上传模式）

用户可以跳过前置步骤，直接从某一步开始，只需上传对应的素材文件。

### 5.1 入口 UI

每个待执行步骤的卡片底部提供"上传素材直接开始"折叠区：

```
┌────────────────────────────────────────────────────┐
│ ② 图片生成                              ● 待执行   │
├────────────────────────────────────────────────────┤
│ 需要先完成步骤①，或                               │
│ ▶ 上传现有图片文件直接跳过生成                     │
│   [拖拽上传图片文件夹或 ZIP]                       │
│                                                    │
│                         [生成图片]   [上传并跳过]  │
└────────────────────────────────────────────────────┘
```

### 5.2 各步骤需上传的文件

| 步骤 | 需上传素材 | 格式要求 |
|------|-----------|---------|
| 分镜 | `storyboard.json` | 符合 Shot schema |
| 图片 | `{shot_id}.png` × N | 文件名匹配 shot_id |
| TTS | `{shot_id}_action.mp3` + `{shot_id}_dialogue.mp3` (可选) | MP3 文件（edge-tts 输出）|
| 视频 | `{shot_id}.mp4` × N | 文件名匹配 shot_id |

### 5.3 处理流程

```
用户上传文件
    ↓
POST /api/projects/[id]/upload
    ↓
API 路由将文件存入对应目录（images/、audio/、clips/）
    ↓
更新 state.json（该步骤 status = "completed"）
    ↓
触发下一步的"可执行"状态
```

---

## 6. 错误处理 UI

### 6.1 单 shot 失败（可重试）

```
┌────────────────────────────────────────────────────┐
│ ② 图片生成                           ⚠ 部分失败   │
├────────────────────────────────────────────────────┤
│ ████████████░░░░░  9/10 完成，1 个失败             │
│                                                    │
│ ✗ E01_007  CUDA OOM，生成失败  [重试单张]          │
│                                                    │
│ 9 张已生成完毕，可继续下一步或重试失败项           │
├────────────────────────────────────────────────────┤
│           [忽略失败，继续下一步]  [重试失败的 shot] │
└────────────────────────────────────────────────────┘
```

"重试失败的 shot"：重新提交 Job，利用断点续传（已成功的 shot 文件存在，会自动跳过）。

### 6.2 整体 Job 失败

```
┌────────────────────────────────────────────────────┐
│ ④ 视频生成                                ✗ 失败   │
├────────────────────────────────────────────────────┤
│ 错误：audio_durations.json 不存在，请先完成 TTS 生成 │
│                                                    │
│ 排查建议：检查步骤③ TTS 是否已正常完成             │
├────────────────────────────────────────────────────┤
│                                           [重试]   │
└────────────────────────────────────────────────────┘
```

### 6.3 服务不可用（health check 失败）

PipelineWizard 启动时对各服务调用 `/health`：

```
⚠ image-service 不可用（端口 8002 无响应）
  请确认 Docker 容器已启动：docker compose up image-service
```

---

## 7. 静态资源访问

Docker 服务生成的文件存放在宿主机共享目录，Next.js 通过 API 路由代理访问：

```typescript
// app/api/projects/[id]/files/[...path]/route.ts
export async function GET(req: Request, { params }) {
  const filePath = path.join(PROJECTS_BASE_DIR, params.id, ...params.path);
  const file = await fs.readFile(filePath);
  return new Response(file, {
    headers: { "Content-Type": getMimeType(filePath) },
  });
}
```

**文件路径映射：**

| 文件类型 | URL 路径 | 实际路径 |
|---------|---------|---------|
| 图片 | `/api/projects/{id}/files/images/{shot}.png` | `/app/projects/{id}/images/{shot}.png` |
| 音频 | `/api/projects/{id}/files/audio/{shot}_action.mp3` | `/app/projects/{id}/audio/...` |
| 视频片段 | `/api/projects/{id}/files/clips/{shot}.mp4` | `/app/projects/{id}/clips/...` |
| 最终视频 | `/api/projects/{id}/files/output/final.mp4` | `/app/projects/{id}/output/final.mp4` |
| 字幕 | `/api/projects/{id}/files/output/final.srt` | `/app/projects/{id}/output/final.srt` |

---

## 8. 服务地址配置

```typescript
// lib/services.ts
export const SERVICE_URLS = {
  storyboard: process.env.STORYBOARD_SERVICE_URL ?? "http://localhost:8001",
  image:      process.env.IMAGE_SERVICE_URL      ?? "http://localhost:8002",
  tts:        process.env.TTS_SERVICE_URL        ?? "http://localhost:8003",
  video:      process.env.VIDEO_SERVICE_URL      ?? "http://localhost:8004",
  assembly:   process.env.ASSEMBLY_SERVICE_URL   ?? "http://localhost:8005",
} as const;

export type StepName = keyof typeof SERVICE_URLS;
```

**环境变量（`.env.local`）：**
```
PROJECTS_BASE_DIR=/app/projects
STORYBOARD_SERVICE_URL=http://storyboard-service:8000
IMAGE_SERVICE_URL=http://image-service:8000
TTS_SERVICE_URL=http://tts-service:8000
VIDEO_SERVICE_URL=http://video-service:8000
ASSEMBLY_SERVICE_URL=http://assembly-service:8000
```

---

## 9. 状态同步策略

```
┌──────────┐     SWR 轮询（5s）      ┌──────────────────┐
│  Browser  │ ─────────────────────▶ │ /api/projects/   │
│           │ ◀───── ProjectState ── │   [id]/state     │
│           │                        └────────┬─────────┘
│           │                                 │ 读取
│           │      SSE 实时流                 ▼
│           │ ──────────────────────▶ state.json（宿主机）
│           │ ◀── progress/complete ──        ▲
│           │                                 │ 写入
│           │                        ┌────────┴─────────┐
│           │                        │ SSE 代理 API 路由 │
│           │                        └──────────────────┘
└──────────┘
```

- **SWR 轮询**：每 5 秒刷新 `ProjectState`，用于页面初始化和后台恢复
- **SSE 实时流**：步骤执行期间的实时进度（不通过轮询，避免延迟）
- **SSE 代理写 state**：SSE 代理路由监听到 `complete` 或 `error` 时，同步更新 `state.json`，确保轮询可读到最新状态

---

## 10. 步骤生命周期控制 UI（【新增】暂停/恢复/停止）

> 详细设计见关联文档 `08-step-lifecycle-control.md`。本节仅描述 UI 层面的变更。

### 10.1 扩展后的状态徽章

| 状态 | Badge 文本 | Badge 样式 |
|------|-----------|-----------|
| pending | 待执行 | `bg-zinc-100 text-zinc-500` |
| in_progress | 执行中 | `bg-blue-100 text-blue-700` |
| paused | 已暂停 | `bg-amber-100 text-amber-700` |
| stopped | 已停止 | `bg-orange-100 text-orange-700` |
| completed | 已完成 | `bg-green-100 text-green-700` |
| failed | 失败 | `bg-red-100 text-red-700` |

### 10.2 各状态的操作按钮

```
┌────────────────────────────────────────────────────────┐
│ ④ 视频生成                                    执行中   │
├────────────────────────────────────────────────────────┤
│ ████████░░░░░░░░░░  2/10                               │
│ 当前：E01_003 生成中...（约 5 分钟/片段）             │
├────────────────────────────────────────────────────────┤
│                              [⏸ 暂停]  [■ 停止]       │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ ④ 视频生成                                    已暂停   │
├────────────────────────────────────────────────────────┤
│ ████████░░░░░░░░░░  2/10                               │
│ 状态：已暂停，点击继续恢复执行                         │
├────────────────────────────────────────────────────────┤
│                              [▶ 继续]  [■ 停止]        │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ ④ 视频生成                                    已停止   │
├────────────────────────────────────────────────────────┤
│ 已生成 2/10，任务已停止                                │
│ 重新开始将自动跳过已生成的片段                         │
├────────────────────────────────────────────────────────┤
│                                       [重新开始]       │
└────────────────────────────────────────────────────────┘
```

### 10.3 useStepControl Hook

```typescript
// hooks/useStepControl.ts
export function useStepControl(projectId: string, mutateState: () => Promise<void>) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const pauseStep = useCallback(async (step: StepName) => {
    await fetch(`/api/pipeline/${projectId}/${step}/pause`, { method: "POST" });
    await mutateState();
  }, [projectId, mutateState]);

  const resumeStep = useCallback(async (step: StepName) => {
    await fetch(`/api/pipeline/${projectId}/${step}/resume`, { method: "POST" });
    await mutateState();
  }, [projectId, mutateState]);

  const stopStep = useCallback(async (step: StepName) => {
    await fetch(`/api/pipeline/${projectId}/${step}/stop`, { method: "POST" });
    await mutateState();
  }, [projectId, mutateState]);

  return { pauseStep, resumeStep, stopStep, loading };
}
```

### 10.4 自动模式与暂停的交互

- **暂停状态阻塞自动推进**：`autoMode` 仅在步骤为 `completed` 时触发下一步
- 如果步骤为 `paused`，`autoMode` 不会触发任何操作
- 用户 `resume` 后，该步骤继续执行，完成后如果 `autoMode` 开启，正常触发下一步
- 如果用户 `stop` 后 `restart`，重新开始执行，完成后如果 `autoMode` 开启，正常触发下一步

### 10.5 断点续传提示

`stopped` 状态的步骤卡片显示提示信息：

```
已生成 2/10 个片段，任务已停止。
重新开始将自动跳过已生成的文件，无需从头再来。
```

---

## 11. 技术栈汇总

| 技术 | 用途 |
|------|------|
| Next.js 15 (App Router) | 页面路由、API Routes |
| React 19 | UI 组件 |
| shadcn/ui + Tailwind CSS | 基础组件库和样式 |
| SWR | 项目状态轮询 |
| EventSource API | SSE 进度接收 |
| HTML5 `<audio>` / `<video>` | 媒体播放 |

---

## 12. 关键时序（全流程 auto-mode）

```
用户                  Next.js              各服务
 │                       │                    │
 ├─ 新建项目 ─────────▶  │                    │
 ├─ 粘贴文本 ─────────▶  │                    │
 ├─ 开启自动模式 ──────▶  │                    │
 ├─ 点击"开始" ───────▶  │                    │
 │                       ├─ POST /jobs ──────▶ storyboard-service
 │◀── SSE: progress ─────│◀── SSE ────────────│
 │◀── SSE: complete ─────│                    │
 │                       ├─ 更新 state.json    │
 │                       ├─ POST /jobs ──────▶ image-service
 │                       ├─ POST /jobs ──────▶ tts-service（并行）
 │◀── SSE: image ─────── │◀── SSE ────────────│
 │◀── SSE: tts ──────────│◀── SSE ────────────│
 │                       │  (image 完成)       │
 │                       ├─ POST /model/unload▶ image-service
 │                       │  (tts 完成)         │
 │                       ├─ POST /jobs ──────▶ video-service
 │◀── SSE: video ─────── │◀── SSE ────────────│
 │                       ├─ POST /model/unload▶ video-service
 │                       ├─ POST /jobs ──────▶ assembly-service
 │◀── SSE: assembly ─────│◀── SSE ────────────│
 │◀── 最终视频就绪 ───── │                    │
```

**全流程预计耗时（10 shots，无缓存）：**

| 步骤 | 时长 |
|------|------|
| 分镜生成 | ~1 分钟 |
| 图片生成（并行 TTS）| ~18 分钟 |
| TTS 生成（并行图片）| ~4 分钟（不占关键路径）|
| 视频生成 | ~52 分钟 |
| 素材合并 | ~2 分钟 |
| **合计** | **约 75 分钟** |

---

## 文档更新记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2026-04-18 | v1.0 | 初始版本，完整 Web UI 设计 | Sisyphus |
| 2026-04-20 | v1.1 | 【新增】步骤生命周期控制 UI（暂停/恢复/停止） | Sisyphus |
| 2026-04-20 | v1.2 | 【新增】reset/regenerate-item 路由、step-artifacts/delete-project-dialog/confirm-dialog 组件、files API 路由、暂停/停止状态枚举 | Claude Sonnet 4.6 |

---

*关联文档*：
- `08-step-lifecycle-control.md` — 步骤级生命周期控制详细设计（后端+前端完整架构）
