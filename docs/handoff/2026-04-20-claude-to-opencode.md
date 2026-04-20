# 交接文档 — Claude Sonnet 4.6 → OPENCODE

> **交接时间**：2026-04-20  
> **交接人**：Claude Sonnet 4.6  
> **接收人**：OPENCODE  
> **工作目录**：`D:\work\novel-workflow`  
> **当前分支**：`develop`

---

## 一、项目一句话背景

将小说文本通过 AI Pipeline 自动生成动漫风格短视频（分镜 → 图片 → 配音 → 视频片段 → 拼装合成）。Web UI 管理整个 Pipeline 流程，Next.js 前端 + 5 个 FastAPI 后端微服务（Docker），本地 Windows 11 + RTX 5070 Ti 12GB VRAM 运行。

---

## 二、本次会话完成的所有工作（按提交顺序）

### 2.1 修复产物预览（commit `cea8c00`）

**问题**：执行中的步骤，实时生成的图片/音频/视频不显示在页面上。  
**根因**：`progressArtifacts`（SSE 实时数据）没有传入 `StepArtifacts` 组件。  
**修复文件**：
- `apps/web/components/step-artifacts.tsx` — 新增 `ProgressArtifactsView` 子组件，支持 in_progress 状态下的实时图片网格/音频列表/视频列表
- `apps/web/app/projects/[id]/page.tsx` — `StepArtifactsWrapper` 接收并传入 `progressArtifacts`

---

### 2.2 从磁盘恢复 state.json（commit `aa1cf7e`）

**问题**：旧项目（state.json 缺失或格式旧）进入项目页面时无产物展示，步骤全为 pending。  
**修复**：
- `apps/web/lib/project-store.ts` — 新增 `recoverStateFromDisk()`：扫描磁盘产物（images/、audio/、clips/、output/）重建 ProjectState，写入 state.json
- `readState()` 中：ENOENT → 触发恢复；result=null → 从磁盘重建；旧格式 result（无 `type` 字段）→ 自动迁移包装
- `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` — `complete` 事件将后端返回的 raw result 包装为 `{ type: stepName, data: rawResult }` 格式

---

### 2.3 修复部分完成步骤状态误判（commit `3570c6e`）

**问题**：只生成了 2 张图就暂停的项目，恢复后状态显示"已完成"而非"已停止"，"继续生成"按钮消失。  
**修复**：
- `apps/web/lib/project-store.ts` — 新增 `recoverStepStatus()`：比较磁盘文件数量与 storyboard.json 中的 shot 总数，相等才判为 completed，否则判为 stopped
- 修复 `useStepControl.ts`：async 错误改为本地 catch + `setErrors` state，不再 throw 导致 Next.js error overlay

---

### 2.4 删除项目功能（feature/delete-project → develop，commit `e2fc1c6`）

**PRD**：`docs/product/prd/delete-project.md`

**新增文件**：
- `apps/web/app/api/projects/[id]/route.ts` — `DELETE /api/projects/:id`：检查无活跃步骤 → 递归删除项目目录 → 204
- `apps/web/components/delete-project-dialog.tsx` — 确认弹窗组件（带项目名、警告文案、错误展示）

**修改文件**：
- `apps/web/app/projects/page.tsx` — 项目卡片右上角 hover 显示垃圾桶图标，点击触发确认弹窗
- `apps/web/app/projects/[id]/page.tsx` — Header 右侧新增"删除项目"按钮

---

### 2.5 修复 SSE 断线后重启不重连问题（fix/pause-restart → develop，commit `3bac540`）

**问题**：步骤停止后再点"重新开始"，进度条和实时产物不显示（EventSource 不重建）。  
**根因**：`useStepProgress` 的 `isComplete` state 在 stopped 后永久为 `true`，guard `if (!active || isComplete) return` 阻止了新 EventSource 创建。  
**修复文件**：
- `apps/web/hooks/useStepProgress.ts` — 新增 `useEffect`：当 `active` 变为 true 时重置 isComplete/isPaused/isStopped/events
- `apps/web/app/projects/[id]/page.tsx`（`StepArtifactsWrapper`）— 步骤处于 in_progress/paused 时，传 `result=null` 给 `StepArtifacts`，防止旧产物在重跑期间显示
- `apps/web/app/api/pipeline/[id]/[step]/start/route.ts` — 启动新 job 时写入 `result: null`，从源头清除旧数据

---

### 2.6 重新生成功能（feature/regenerate-artifact → develop，commit `0bd6f68`）

**PRD**：`docs/product/prd/regenerate-artifact.md`

**后端新增**：
- `apps/web/app/api/pipeline/[id]/[step]/reset/route.ts` — `POST /api/pipeline/:id/:step/reset`：清空该步骤磁盘产物（images/、audio/、clips/ 等），重置 state 为 pending
- `apps/web/app/api/pipeline/[id]/[step]/regenerate-item/route.ts` — `POST .../regenerate-item`：接收 `{ shot_id }`，只删除该 shot 对应的文件，前端随后调用 start 补生成
- `apps/web/lib/project-store.ts` — `recoverStepResult` 改为 export（供 events/route.ts 复用）
- `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` — complete 事件改为从磁盘重建 result，防止部分重生成后其他 shot 数据丢失

**前端新增**：
- `apps/web/components/confirm-dialog.tsx` — 通用确认弹窗（供重新生成 + 其他操作复用）
- `apps/web/components/step-artifacts.tsx` — 每个图片/音频/视频产物 hover 时右上角显示 🔄 图标
- `apps/web/app/projects/[id]/page.tsx` — 步骤卡片底部新增"↺ 重新生成全部"按钮（completed/stopped 时显示）；新增 `regenerateStep()`（reset→start）和 `regenerateItem()`（regenerate-item→start）

---

### 2.7 修复暂停/继续/停止操作在服务重启后报错（fix/control-job-not-found → develop，commit `c8eae09`）

**问题**：点"继续"时出现 `{"detail":"Not Found"}`，操作无响应。  
**根因**：Python 后端服务重启后内存中 job 记录消失，但 state.json 仍保留旧 `job_id`。调用 `/jobs/{job_id}/resume` 时 FastAPI 返回 404。  
**修复文件**：
- `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts` — 服务返回 404 时，自动将步骤状态改为 stopped，返回友好提示"任务已失效，请点击重新开始"
- `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts` — 同上（自动改为 stopped）
- `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` — job 已消失时直接视为停止成功（不报错）
- `apps/web/hooks/useStepControl.ts` — 修复错误消息解析：`body.error` 可能是嵌套 JSON 字符串（FastAPI `{"detail":"..."}`），现在正确展开；出错时也调用 `mutateState()` 立即刷新 UI

---

## 三、当前 develop 分支 Git Log（最近 8 条）

```
c8eae09  fix(web): handle job-not-found (404) in pause/resume/stop control routes
0bd6f68  feat(web): add step-level and per-item artifact regeneration
3bac540  fix(web): fix SSE reconnection and stale result display after step restart
e2fc1c6  feat(web): add delete project feature with confirmation dialog
3570c6e  fix(web): correct partial-step recovery status and improve error handling
aa1cf7e  fix(web): recover step results from disk and fix result type wrapping
cea8c00  fix(web): wire progressArtifacts to StepArtifacts for in-progress preview
be5ae06  docs: comprehensive HANDOFF update 2026-04-20
```

---

## 四、项目整体状态（截止本次交接）

| 模块 | 状态 | 备注 |
|------|------|------|
| Next.js 前端（项目列表/Pipeline Wizard） | ✅ 可用 | `http://localhost:3000` |
| 删除项目功能 | ✅ 可用，已验证 | 列表页 + 详情页双入口 |
| 暂停/恢复/停止 | ✅ 可用（服务在线时） | 服务重启后 job 失效，现在能优雅降级为 stopped |
| 实时产物预览（执行中） | ✅ 可用 | SSE progressArtifacts 实时刷新 |
| 持久化产物预览（完成后） | ✅ 可用 | state.json result 字段，刷新页面保留 |
| 磁盘恢复（state.json 缺失） | ✅ 可用 | 扫描 images/audio/clips/output 重建 |
| 重新生成全部 | ✅ 实现完毕 | 完成/停止状态下底部显示"↺ 重新生成全部" |
| 产物级单项重新生成 | ✅ 实现完毕 | hover 产物卡片显示 🔄 图标 |
| storyboard-service | ✅ Docker 运行 | Kimi API，需 KIMI_API_KEY |
| tts-service | ✅ Docker 运行 | edge-tts，无需额外配置 |
| image-service | ✅ Docker 运行，GPU 已修复 | FLUX.1-dev NF4，用户确认已可正常推理 |
| video-service | ⚠️ Docker 运行，内存可能不足 | Wan2.1 T5 encoder 加载需 ~18GB RAM，Docker Desktop 需调至 24GB |
| assembly-service | ✅ Docker 运行 | FFmpeg 拼装 |

---

## 五、已知问题 & 待处理事项

### 🔴 P0：仍需验证的核心功能

1. **重新生成功能尚未经用户全面验证**  
   用户刚启动服务审查时发现"继续"按钮报 404（已修复），尚未完整验证重新生成、产物 🔄 图标等新功能。

2. **video-service Docker 内存不足**  
   Wan2.1 的 T5 encoder（11GB）加载时可能触发 OOM Killer（容器被 SIGKILL，exit code 137）。  
   修复：Docker Desktop → Settings → Resources → Memory → 调至 **24 GB** → Apply & Restart。

### 🟡 P1：边界情况未覆盖

3. **产物级重新生成（🔄）依赖服务支持 `shot_ids` 过滤**  
   `regenerate-item/route.ts` 在 start 请求的 config 中传入 `shot_ids: [shot_id]`，但后端 Python 服务（image/tts/video）是否读取并只处理指定 shot 尚未验证。如果服务忽略 `shot_ids`，会重跑所有 shot（但跳过已有文件，仅重生成被删除的那个），行为上仍正确，只是性能上多余。

4. **重新生成全部后，auto-mode（自动模式）不会自动继续后续步骤**  
   当前 auto-mode 逻辑只检测"当前步骤 completed + 下一步骤 pending"才自动推进。如果重新生成将步骤改为 pending 后重跑完成，需要确认 auto-mode 是否会正确触发后续步骤。

5. **分镜（storyboard）完成后的重新生成未测试**  
   分镜 reset 会删除 `storyboard.json`，这会导致后续步骤（image/tts）依赖的数据消失。如果后续步骤已完成，重新生成分镜后需要手动重跑后续步骤（当前没有级联重置逻辑）。PRD 明确说明 v1.0 不做级联，但用户体验上可能困惑。

6. **assembly 步骤不支持产物级重新生成**  
   `regenerate-item/route.ts` 已正确返回 400 for unsupported step，但前端 `StepArtifacts` 的 assembly 子组件没有传 `onRegenerateItem`（`AssemblyArtifacts` 不接收该 prop），行为一致，但没有文字说明"不支持"。

### 🟢 P2：体验优化

7. **产物级重新生成期间，其他已完成产物暂时消失**  
   点击单项 🔄 后，step 变为 in_progress，`StepArtifactsWrapper` 将 result 置 null（防止旧产物干扰），此时只显示新生成的 1 个产物，其他 shot 的产物暂时不可见，直到 job 完成才从磁盘重建。PRD 接受此行为，但用户可能困惑。

8. **state.json 中 `result` 字段的 audio_files 是文件名列表**  
   恢复时 `recoverStepResult` 对 tts 只存文件名（相对路径），但 `TTSArtifacts` 组件构造 URL 时用 `/api/projects/${projectId}/files/audio/${filename}`。需确认文件名格式一致（当前 `parseAudioFilename()` 假设格式为 `{shotId}_{trackType}.mp3`）。

---

## 六、关键文件速查

### 前端核心文件

| 功能 | 文件 |
|------|------|
| 步骤状态类型 + state.json 读写 | `apps/web/lib/project-store.ts` |
| SSE 进度监听 Hook | `apps/web/hooks/useStepProgress.ts` |
| 暂停/恢复/停止操作 Hook | `apps/web/hooks/useStepControl.ts` |
| SWR 项目状态轮询 Hook | `apps/web/hooks/useProjectState.ts` |
| Pipeline 页面（步骤卡片 UI） | `apps/web/app/projects/[id]/page.tsx` |
| 产物预览组件 | `apps/web/components/step-artifacts.tsx` |
| 删除项目弹窗 | `apps/web/components/delete-project-dialog.tsx` |
| 通用确认弹窗 | `apps/web/components/confirm-dialog.tsx` |

### 前端 API Routes

| 路由 | 文件 |
|------|------|
| GET/POST /api/projects | `apps/web/app/api/projects/route.ts` |
| DELETE /api/projects/:id | `apps/web/app/api/projects/[id]/route.ts` |
| GET /api/projects/:id/state | `apps/web/app/api/projects/[id]/state/route.ts` |
| GET /api/projects/:id/files/[...path] | `apps/web/app/api/projects/[id]/files/[...path]/route.ts` |
| POST .../start | `apps/web/app/api/pipeline/[id]/[step]/start/route.ts` |
| GET .../events (SSE proxy) | `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` |
| POST .../pause | `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts` |
| POST .../resume | `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts` |
| POST .../stop | `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` |
| POST .../reset | `apps/web/app/api/pipeline/[id]/[step]/reset/route.ts` |
| POST .../regenerate-item | `apps/web/app/api/pipeline/[id]/[step]/regenerate-item/route.ts` |

### 关键配置文件

| 文件 | 说明 |
|------|------|
| `apps/web/.env.local` | `PROJECTS_BASE_DIR=D:/work/novel-workflow/projects`（gitignored，本地必须存在） |
| `D:\work\novel-workflow\.env` | Docker 服务环境变量（KIMI_API_KEY、模型路径等） |
| `docker-compose.yml` | 5 个后端服务容器定义 |

---

## 七、启动方式

```bash
# 1. 确认 .env.local 存在（Next.js 本地开发必须）
# 文件内容：PROJECTS_BASE_DIR=D:/work/novel-workflow/projects

# 2. 启动所有后端服务（已运行则跳过）
cd D:\work\novel-workflow
docker compose up -d

# 3. 启动前端开发服务器
cd D:\work\novel-workflow\apps\web
npx next dev --port 3000

# 前端访问：http://localhost:3000
```

---

## 八、数据模型速查

### ProjectState（state.json）

```typescript
interface ProjectState {
  project_id: string;
  title: string;
  episode: string;
  created_at: string;
  steps: Record<StepName, StepState>;  // StepName = "storyboard"|"image"|"tts"|"video"|"assembly"
}

interface StepState {
  status: "pending" | "in_progress" | "paused" | "stopped" | "completed" | "failed";
  job_id: string | null;
  updated_at: string;
  result?: StepResult | null;
}

type StepResult =
  | { type: "storyboard"; data: { shot_count: number; storyboard_path: string } }
  | { type: "image";      data: { images: Array<{ shot_id: string; filename: string }>; total: number } }
  | { type: "tts";        data: { audio_files: string[]; total_tracks: number } }
  | { type: "video";      data: { clips: Array<{ shot_id: string; filename: string; duration: number }>; total: number } }
  | { type: "assembly";   data: { video_path: string; srt_path: string; duration: number } };
```

### 产物文件路径规范

```
projects/{project_id}/
├── state.json
├── input.txt
├── storyboard.json
├── images/{shot_id}.png          (或 .jpg / .webp)
├── audio/{shot_id}_action.mp3    (旁白)
├── audio/{shot_id}_dialogue.mp3  (台词)
├── clips/{shot_id}.mp4
└── output/
    ├── final.mp4
    └── final.srt
```

---

## 九、服务接口速查（后端 FastAPI）

所有服务均实现统一接口：

```
POST /jobs                 → { job_id }       # 创建并启动 Job
GET  /jobs/{job_id}/events → SSE stream       # 监听进度
GET  /jobs/{job_id}/status → { status, ... }
POST /jobs/{job_id}/pause  → { status }
POST /jobs/{job_id}/resume → { status }
POST /jobs/{job_id}/stop   → { status }
GET  /health               → { status: "ok" }
```

SSE 事件类型：`progress` / `paused` / `resumed` / `stopped` / `complete` / `error`

---

## 十、Git-Flow 规范（本项目强制执行）

```
master  ← 仅存放稳定版本，不直接提交
  └── develop  ← 所有开发基础，每个 feature 合并至此
        └── feature/*  ← 每个功能/修复一个分支
        └── fix/*      ← bug 修复分支
```

**流程**：
```bash
git checkout develop
git checkout -b feature/your-feature-name
# ... 开发 ...
git add <files>
git commit -m "feat(web): ..."
git checkout develop
git merge --no-ff feature/your-feature-name -m "Merge feature/..."
```

**注意**：每次 commit 必须附上 `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`（或相应 agent 名称）

---

*由 Claude Sonnet 4.6 编写 | 2026-04-20*
