# Handoff Document — Novel Workflow v1.0

> **生成时间**：2026-04-19  
> **生成者**：Sisyphus Agent  
> **状态**：Phase 1-3 开发中（由另一 Agent 执行）  
> **目标读者**：执行编码的 Agent

---

## 0. 开始前的第一步（必须按顺序执行）

```bash
# Step 1: 创建并推送 develop 分支（只需执行一次）
git checkout -b develop master
git push -u origin develop

# Step 2: 切出第一个 feature 分支，开始编码
git checkout -b feature/phase-1-skeleton develop
```

**不要在 master 上直接编码。**

---

## 1. 项目概况（TL;DR）

**Novel Workflow** 是一个单用户本地工具，将小说文本自动转化为**动漫风格短视频**（带配音+字幕）。

- **技术栈**：Next.js 15 + 5个 FastAPI Docker 微服务
- **核心 Pipeline**：分镜生成 → 图片生成 → TTS音频 → 视频片段 → 素材拼装
- **硬件约束**：单张 RTX 5070 Ti 12GB，GPU 串行执行
- **目标**：v1.0 Core MVP，打通完整链路

---

## 2. 当前状态

### ✅ 已完成（文档层面）

| 模块 | 文档路径 | 状态 |
|------|----------|------|
| PRD | `docs/product/prd/v1.0-core-mvp.md` | 完整 |
| 数据模型 | `docs/technical/design/00-data-model.md` | 完整 |
| 服务层设计 | `docs/technical/design/01-services-overview.md` | 完整 |
| storyboard-service | `docs/technical/design/02-service-storyboard.md` | 完整 |
| image-service | `docs/technical/design/03-service-image.md` | 完整 |
| tts-service | `docs/technical/design/04-service-tts.md` | 完整 |
| video-service | `docs/technical/design/05-service-video.md` | 完整 |
| assembly-service | `docs/technical/design/06-service-assembly.md` | 完整 |
| WebUI 设计 | `docs/technical/design/07-webui-design.md` | 完整（含所有 API Routes、组件、SSE hook）|
| 技术架构 | `docs/technical/architecture/001-tech-stack.md` | 完整 |
| 开发计划 | `docs/development-plan.md` | 完整（含用户确认）|
| UI 调研 | `docs/research/ui-design/` | 完整 |
| AI 服务调研 | `docs/research/ai-services/` | 完整 |

### 🚧 进行中（编码阶段）

**你的任务**：完成 Phase 1-3 的编码工作

| Phase | 内容 | 范围 |
|-------|------|------|
| **Phase 1** | 项目骨架 + 通用模块 | `services/` 目录结构、`shared/job_manager.py`、`shared/model_manager.py`、`.env.example` |
| **Phase 2** | 5个后端服务 | storyboard / image / tts / video / assembly |
| **Phase 3** | Next.js 前端 | 项目初始化、API Routes、Pipeline Wizard、各步骤组件 |

### ⏳ 暂停（等待用户审核）

| Phase | 内容 | 说明 |
|-------|------|------|
| **Phase 4** | 集成与部署 | **必须在 Phase 1-3 完成并经用户确认后，方可启动** |

---

## 3. Git-Flow 分支规范（必须遵守）

本项目采用 **Git-Flow** 规范进行分支管理。

### 分支定义

| 分支 | 用途 | 规则 |
|------|------|------|
| `master` | 生产环境 | **不要直接提交**。仅存放稳定版本 |
| `develop` | 开发集成 | **所有编码工作的基础分支**。从 `master` 切出 |
| `feature/*` | 功能开发 | **从 `develop` 切出**。每个 Phase 或独立服务一个分支 |

### 当前状态

- `master` 分支：已完成所有设计文档
- **下一步**：创建 `develop` 分支（从 `master` 切出），然后从 `develop` 切出各个 `feature/*` 分支

### 你的工作流程

```bash
# 1. 创建 develop 分支（只需执行一次）
git checkout -b develop master
git push -u origin develop

# 2. 开始每个任务前，从 develop 创建 feature 分支
git checkout develop
git pull origin develop
git checkout -b feature/phase-1-skeleton

# 3. 开发完成后，合并回 develop
git checkout develop
git merge --no-ff feature/phase-1-skeleton
git push origin develop

# 4. 删除已合并的 feature 分支
git branch -d feature/phase-1-skeleton
```

### Feature 分支命名

```
feature/phase-1-skeleton          # Phase 1: 项目骨架 + 通用模块
feature/storyboard-service        # storyboard-service
feature/tts-service               # tts-service
feature/image-service             # image-service
feature/video-service             # video-service
feature/assembly-service          # assembly-service
feature/webui-frontend            # Next.js 前端
```

### Commit Message 规范

```
feat: add storyboard-service with KimiProvider
feat: implement FluxLocalProvider with 4-bit quantization
fix: handle CUDA OOM in image-service
refactor: extract shared ModelManager
docs: update HANDOFF with progress
```

### 重要规则

- ✅ **每个 feature 完成后立即合并到 develop**
- ✅ **定期 push develop 到远程**（至少每天一次）
- ✅ **不要在 feature 分支长期停留**
- ❌ **不要直接修改 master 分支**
- ❌ **不要在 feature 分支合并其他 feature 分支**

---

## 4. 你的任务清单

### Phase 1: 项目骨架与通用模块（~7小时）

**任务 1.1**：创建 `services/` 目录结构
```
services/
├── storyboard/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   └── providers/
│       ├── __init__.py
│       ├── base.py
│       └── kimi.py
├── image/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   └── providers/
│       ├── __init__.py
│       ├── base.py
│       └── flux_local.py
├── tts/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   └── providers/
│       ├── __init__.py
│       ├── base.py
│       └── edge_tts.py
├── video/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   └── providers/
│       ├── __init__.py
│       ├── base.py
│       └── wan_local.py
├── assembly/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py
│   ├── assembler.py
│   └── srt_generator.py
└── shared/
    ├── __init__.py
    ├── job_manager.py
    └── model_manager.py
```

**任务 1.2**：实现 `shared/job_manager.py`
- 通用 Job 生命周期管理（所有5个服务共用）
- Job 状态机：queued → in_progress → completed/failed/cancelled
- SSE 事件流：progress / complete / error
- 内存管理：JobRecord 存储、TTL 清理
- 设计参考：`docs/technical/design/01-services-overview.md` 第2节

**任务 1.3**：实现 `shared/model_manager.py`
- `ModelManager`：GPU 服务通用（image-service）
  - 按需加载、TTL 自动卸载、强制卸载
- `VideoModelManager`：video-service 专用
  - subprocess 进程锁管理（不是模型加载）
- 设计参考：`docs/technical/design/01-services-overview.md` 第3节

**任务 1.4**：创建 `.env.example`
- 所有服务的环境变量模板
- 模型路径、API Keys、端口配置

### Phase 2: 后端服务（~27小时）

**任务 2.1**：storyboard-service（端口 8001）
- FastAPI 骨架 + Dockerfile
- KimiProvider：调用 Kimi API 生成 storyboard.json
- 集成 JobManager
- MVP参考：`D:/work/novel-comic-drama-2/storyboard_generator.py`
- 设计参考：`docs/technical/design/02-service-storyboard.md`

**任务 2.2**：tts-service（端口 8003）
- FastAPI 骨架 + Dockerfile
- EdgeTTSProvider：edge-tts 调用，旁白/对话双轨
- 生成 `audio_durations.json`
- 集成 JobManager，断点续传
- MVP参考：`D:/work/novel-comic-drama-2/generate_audio.py`
- 设计参考：`docs/technical/design/04-service-tts.md`

**任务 2.3**：image-service（端口 8002）
- FastAPI 骨架 + Dockerfile（GPU镜像）
- FluxLocalProvider：4-bit 量化加载 + 单张生成
- 集成 ModelManager（按需加载、TTL卸载）
- 断点续传
- MVP参考：`D:/work/novel-comic-drama-2/batch_generate_flux.py`
- 设计参考：`docs/technical/design/03-service-image.md`

**任务 2.4**：video-service（端口 8004）
- FastAPI 骨架 + Dockerfile（GPU镜像）
- WanSubprocessProvider：subprocess 调用 Wan2.1/generate.py
  - **关键**：实现 `_generate_lock` 信号量（防止并发）
  - **关键**：超时保护（600s）+ 强制 kill
  - **关键**：临时文件 + 原子写入
  - **关键**：FFmpeg 冻结帧补齐（TTS 时长 > 默认时长时）
- 集成 VideoModelManager
- 断点续传
- MVP参考：`D:/work/novel-comic-drama-2/batch_generate_wan.py`
- 设计参考：`docs/technical/design/05-service-video.md`

**任务 2.5**：assembly-service（端口 8005）
- FastAPI 骨架 + Dockerfile
- FFmpeg 编排：素材验证 → 时长对齐 → concat → 混音 → 合并
- SRT 字幕生成
- 集成 JobManager
- MVP参考：`D:/work/novel-comic-drama-2/video_assembler.py`
- 设计参考：`docs/technical/design/06-service-assembly.md`

### Phase 3: 前端开发（~22小时）

**任务 3.1**：Next.js 项目初始化
- `npx shadcn@latest init`
- 安装依赖：shadcn 组件 + SWR
- 全局配置：Tailwind 主题 + layout.tsx

**任务 3.2**：API Routes
- `GET/POST/PATCH/DELETE /api/projects` — 项目 CRUD
- `POST /api/pipeline/[id]/[step]/start` — Pipeline 编排
- `GET /api/pipeline/[id]/[step]/events` — SSE 代理
- `GET /api/projects/[id]/files/[...path]` — 文件代理

**任务 3.3**：页面与组件
- `/projects` — 项目列表页
- `/projects/[id]` — Pipeline Wizard（5步骤）
  - StepCard 通用组件
  - StoryboardStep / ImageStep / TTSStep / VideoStep / AssemblyStep
  - AutoModeToggle

---

## 5. 关键设计决策（编码时必须遵守）

### 4.1 数据模型（唯一权威来源：`00-data-model.md`）

**Shot 枚举值**：
- `shot_type`: `wide` / `medium` / `close_up` / `extreme_close_up` / `over_shoulder`
- `camera_move`: `static` / `pan` / `zoom_in` / `zoom_out` / `dolly` / `tracking`

**Storyboard 结构**：
```json
{
  "project": { "title": "...", "episode": "...", "total_shots": 10, "total_duration": 40, "source_novel": "..." },
  "characters": [ { "id": "...", "name": "...", "gender": "...", "appearance": "..." } ],
  "shots": [ /* Shot[] */ ],
  "created_at": "..."
}
```

### 4.2 端口与网络

```
服务容器内部统一监听: 8000
宿主机映射端口:
  storyboard-service → localhost:8001
  image-service      → localhost:8002
  tts-service        → localhost:8003
  video-service      → localhost:8004
  assembly-service   → localhost:8005

Docker 内部网络: 服务名:8000（如 http://image-service:8000）
```

### 4.3 GPU 串行约束

```
image-service 和 video-service 不能同时运行（共享 12GB VRAM）
编排顺序: storyboard → (image + tts 并行) → video → assembly

切换 GPU 服务前必须调用 POST /model/unload
```

### 4.4 Video-Service Subprocess 方式

**关键决策**：video-service **不直接 import Wan 模型**，而是通过 subprocess 调用 `Wan2.1/generate.py`。

原因：Wan 原格式需要官方推理代码 `sys.path.insert`，在 Docker 容器内进程隔离更稳定，且方便强制 kill 超时进程。

```python
# ✅ 正确：subprocess 方式
proc = await asyncio.create_subprocess_exec(
    "python", "/app/models/Wan2.1-T2V-1.3B/generate.py",
    "--prompt", full_prompt, "--output", str(tmp_path), ...,
)
try:
    await asyncio.wait_for(proc.wait(), timeout=600)
except asyncio.TimeoutError:
    proc.kill()
    raise

# ❌ 错误：直接 import（在 Docker 内路径不可控）
# from wan.text2video import WanT2V
```

必须实现的保障机制：
1. `asyncio.Semaphore(1)` 强制串行（防止两个 shot 同时推理）
2. 超时保护（600s）+ 强制 `proc.kill()`
3. 临时文件 + 原子写入（`.tmp.mp4` → `os.replace`）
4. 输出验证（ffprobe 检查时长 > 0）
5. `finally` 块确保信号量释放

### 4.5 进程守护（每个服务的 `main.py` 必须实现）

1. **全局异常捕获 middleware** — 防止未处理异常终止进程
2. **SIGTERM 优雅关闭** — Docker stop 时清理资源
3. **健康检查** — `/health` 只验证 FastAPI 进程正常
4. **Docker restart policy** — `unless-stopped`

详见 `docs/technical/design/01-services-overview.md` 第7节。

### 4.6 Mock 模式

每个服务应支持 `MOCK_MODE=true` 环境变量：
- 返回预置的 fixture 数据，不调用真实模型
- Mock Provider 放在 `providers/mock.py`
- 便于前端联调和流程验证

---

## 6. MVP 参考代码

**不要照抄**，但可参考实现逻辑：

```
D:/work/novel-comic-drama-2/
├── storyboard_generator.py      → 2.1 storyboard-service
├── batch_generate_flux.py       → 2.3 image-service
├── generate_audio.py            → 2.2 tts-service
├── batch_generate_wan.py        → 2.4 video-service
└── video_assembler.py           → 2.5 assembly-service
```

**模型文件位置**：`D:\work\novel-comic-drama\models`
- FLUX.1-dev/ → 挂载到 `/app/models/FLUX.1-dev/`
- Wan2.1-T2V-1.3B/ → 挂载到 `/app/models/Wan2.1-T2V-1.3B/`

---

## 7. 已知陷阱

| 陷阱 | 后果 | 正确做法 |
|------|------|----------|
| image/video 同时运行 | CUDA OOM，容器崩溃 | 严格串行，编排器控制 |
| video-service 直接 import Wan | Docker 内 import 路径问题 | 使用 subprocess 方式 |
| 忽略 subprocess 超时 | 服务假死 | 必须实现 timeout + kill |
| health check 等待模型加载 | 容器启动时间极长 | `/health` 只检查 FastAPI 进程 |
| 使用 xfade 拼接视频 | 多片段时丢内容 | 使用 concat demuxer |
| 视频固定 4 秒 | TTS 被截断 | 自适应延长：max(声明时长, TTS时长+0.5s) |
| 忽略 Windows 路径反斜杠 | FFmpeg 解析错误 | 使用 `as_posix()` |

---

## 8. 环境信息

| 项目 | 值 |
|------|-----|
| 工作目录 | `D:\work\novel-workflow` |
| MVP 参考代码 | `D:\work\novel-comic-drama-2` |
| 模型文件 | `D:\work\novel-comic-drama\models` |
| GPU | NVIDIA RTX 5070 Ti Laptop (12GB VRAM) |
| GPU 架构 | Blackwell (sm_120) |
| OS | Windows 11 |
| Python | 3.12 |
| PyTorch | 2.7.0+cu128 |

---

## 9. 交接要求

### 你必须在完成后更新此文档

在 `HANDOFF.md` 的"当前状态"章节更新，格式：

```markdown
## 当前状态（实时更新）

### ✅ 已完成
- [2.1] storyboard-service — 2026-04-XX — Agent-Name
- [2.2] tts-service — 2026-04-XX — Agent-Name
- ...

### 🚧 进行中
- [3.3] Pipeline Wizard — Agent-Name

### ⏳ 待开始
- [2.4] video-service — 等待 ...
```

### 必须记录的信息
1. **已完成的工作**：任务ID、完成时间、关键变更
2. **新增/修改的文件**：文件路径列表
3. **已知问题**：遇到的坑、未解决的 TODO、临时方案
4. **测试验证结果**：通过的 QA 检查项、失败项及原因
5. **下一步建议**：接下来应该做什么

### 提交代码
- 每个 Phase 完成后 git commit
- 最终完成后 push 到远程仓库
- 更新此 HANDOFF.md 后再次 commit

---

## 10. 限制与边界

### 你**不应该**做的事
- ❌ **不要启动 Phase 4**（集成与部署）— 必须在 Phase 1-3 完成并经用户确认后，由 Sisyphus Agent 或用户决定
- ❌ **不要修改设计文档**（`docs/technical/design/*.md`）— 如有发现文档错误，记录在 HANDOFF.md 中
- ❌ **不要删除或修改 `.env.example`** — 如有新增环境变量，追加到文件末尾
- ❌ **不要提交真实 API Key** — 使用占位符

### 你**应该**做的事
- ✅ 并行开发独立任务（如同时写 storyboard-service 和 tts-service）
- ✅ 使用子 Agent 加速（如让子 Agent 写前端组件）
- ✅ 每个服务完成后立即测试（手动 QA）
- ✅ 遇到设计文档未覆盖的问题，做合理决策并记录在 HANDOFF.md

---

*本文档由 Sisyphus Agent 创建*  
*最后更新：2026-04-19*  
*状态：等待编码 Agent 接手*

---

## 附：Phase 2 并行策略

```
Phase 2 推荐执行顺序（最大化并行）：

  并行组 A（无 GPU 依赖，可同时开发）：
    feature/storyboard-service
    feature/tts-service
    feature/assembly-service

  串行组 B（有 GPU/设计依赖，按序开发）：
    feature/image-service     ← 先完成，ModelManager 是模板
    feature/video-service     ← 参考 image-service 的 ModelManager 设计

Phase 3 等待 Phase 2 主要接口稳定后启动（不必等全部完成）
```
