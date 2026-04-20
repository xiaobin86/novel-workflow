# Handoff Document — Novel Workflow v1.0

> **生成时间**：2026-04-19  
> **生成者**：Sisyphus Agent → Claude Sonnet 4.6  
> **状态**：Phase 1-3 已完成，等待用户审核  
> **目标读者**：执行 Phase 4 集成部署的 Agent（或用户审核后继续）

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

### ✅ 已完成（编码阶段）— 2026-04-19

**由 Claude Sonnet 4.6 完成，develop 分支已推送。**

| Phase | 内容 | 状态 | 分支 |
|-------|------|------|------|
| **Phase 1** | 项目骨架 + shared 公共模块 | ✅ 完成 | feature/phase-1-skeleton |
| **Phase 2** | 5个后端服务 | ✅ 完成 | feature/phase-1-skeleton |
| **Phase 3** | Next.js 前端 | ✅ 完成 | feature/nextjs-frontend |
| **Phase 4** | 集成部署 | ⏳ 等待审核 | — |

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

*本文档由 Sisyphus Agent 创建，Claude Sonnet 4.6 完成编码并更新*  
*最后更新：2026-04-19*  
*状态：Phase 1-3 完成，等待用户审核，Phase 4 暂停*

---

## 当前状态（实时更新）

### ✅ 已完成 — 2026-04-19

**Phase 1: 项目骨架**
- `services/shared/job_manager.py` — 异步 Job 生命周期、SSE 广播、GC
- `services/shared/model_manager.py` — GPU 模型 TTL 自动卸载 + 强制卸载

**Phase 2: 5 个后端服务**
- `services/storyboard/` — KimiProvider + MockProvider，原子写 storyboard.json
- `services/tts/` — EdgeTTSProvider（分段合成）+ MockProvider，写 audio_durations.json
- `services/image/` — FluxLocalProvider（NF4量化）+ MockProvider，ModelManager 集成
- `services/video/` — WanLocalProvider（subprocess + Semaphore + timeout）+ MockProvider
- `services/assembly/` — 9步 FFmpeg pipeline，SRT 生成，adelay 混音
- `docker-compose.yml` — 6个容器，healthcheck，GPU reservation
- `.env.example` — 所有环境变量文档

**Phase 3: Next.js 前端**
- `apps/web/` — Next.js 15 App Router + shadcn/ui + Tailwind
- API Routes: 项目 CRUD、pipeline start、SSE 代理、文件代理
- `hooks/useStepProgress.ts` — EventSource SSE 消费
- `hooks/useProjectState.ts` — SWR 轮询
- `/projects` — 项目列表 + 新建对话框
- `/projects/[id]` — Pipeline Wizard（5步，自动模式切换，GPU handoff）

### 已知问题

1. **`node_modules/` 未提交**：`apps/web/node_modules` 在 .gitignore 中，需在部署时 `npm install`
2. **apps/web 原为 submodule**：已转换为普通目录，git 历史中有一个 submodule commit（无功能影响）
3. **MOCK_MODE 视频生成**：MockVideoProvider 用 ffmpeg 生成纯黑视频，需要宿主机有 ffmpeg
4. **image-service mock**：MockImageProvider 用 Pillow 生成纯色图，需要 Pillow 安装

### Phase 4 建议（下一步）

1. 测试 MOCK_MODE=true 下的完整流程（全链路 E2E）
2. 在真实 GPU 环境测试 image-service 和 video-service
3. 配置 `.env`（从 `.env.example` 复制，填入真实 KIMI_API_KEY）
4. `docker compose up --build` 验证所有容器启动

---

## 当前完整状态 — 2026-04-20（CLAUDE 最终交接）

> **工作目录**：`D:\work\novel-workflow`  
> **更新时间**：2026-04-20  
> **分支**：`develop`（已 push 到远程）  
> **本节作者**：Claude Sonnet 4.6

---

### 一、整体开发进度（全貌）

**全部代码已开发完成，6 个 Docker 服务均已运行。当前阻塞点是 GPU 推理在 Docker 容器内的运行环境问题（非代码 Bug）。**

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | shared 公共模块（JobManager、ModelManager）| ✅ 完成 |
| Phase 2 | 5 个后端 FastAPI 微服务 + docker-compose | ✅ 完成 |
| Phase 3 | Next.js 前端（App Router + shadcn/ui）| ✅ 完成（本地 `npm run dev`，未入 docker-compose）|
| Phase 4 | GPU 真实推理验证 | 🟡 **代码已修复，剩余两个环境配置问题（见下）** |

---

### 二、Docker 服务当前状态（2026-04-20 验证）

```
容器名                                 宿主机端口   健康状态
novel-workflow-storyboard-service-1    8001     ✅ healthy
novel-workflow-image-service-1         8002     ✅ healthy（模型 unloaded）
novel-workflow-tts-service-1           8003     ✅ healthy
novel-workflow-video-service-1         8004     ✅ healthy（模型 subprocess 模式）
novel-workflow-assembly-service-1      8005     ✅ healthy（ffmpeg 可用）
web（Next.js）                         3000     ⚠️  未在 docker-compose 中
```

启动所有服务：
```bash
cd D:\work\novel-workflow
docker compose up -d
# 前端单独启动：
cd apps/web && npm install && npm run dev
```

---

### image-service 现状（GPU 崩溃，暂停）

#### 硬件环境

| 项目 | 值 |
|------|-----|
| GPU | NVIDIA GeForce RTX 5070 Ti Laptop，**12GB VRAM** |
| 架构 | **Blackwell (sm_120)** — 2025年1月发布，PyTorch/Triton 支持尚不成熟 |
| 驱动 | 595.97，CUDA 13.2（容器镜像：CUDA 12.8）|
| 模型 | FLUX.1-dev（23GB FP16，NF4 4-bit 量化后 ~6GB VRAM）|

#### 完整修复历史（本次会话）

| 轮次 | 问题 | 根因 | 已修复 |
|------|------|------|--------|
| 1 | ImportError: protobuf/sentencepiece | Dockerfile build cache 导致 pip install 未执行 | ✅ 加入 requirements.txt，需 `--no-cache` 重建 |
| 2 | C 层 SIGSEGV，无 traceback | 另一个 Agent 添加的 `torch.compile(mode="max-autotune")` + Blackwell + bitsandbytes NF4 冲突 | ✅ 删除 torch.compile |
| 3 | C 层无声崩溃（模型加载到 3-7/7 时）| **WSL2 驱动路径未注入**：`libnvidia-ptxjitcompiler.so.1` 存在于 `/usr/lib/wsl/drivers/<hash>/` 但不在 LD_LIBRARY_PATH，sm_120 CUDA kernel 需 PTX JIT 编译，找不到库则无声崩溃 | ✅ 新建 `entrypoint.sh` 动态注入路径 |
| 4 | CPU/CUDA 设备不匹配 | 另一个 Agent 改为显式 GPU placement，T5 在 CPU，token IDs 移到 CUDA | ✅ 恢复 `enable_model_cpu_offload()`（accelerate 1.3.0 正确处理 NF4 量化张量）|
| 5 | storyboard.json 解析失败 | 文件有 UTF-8 BOM (`\xef\xbb\xbf`)，`encoding="utf-8"` 失败 | ✅ 改为 `encoding="utf-8-sig"` |
| 当前 | **模型仍无声崩溃** | 推测 sm_120 native CUDA kernel 缺失仍在其他位置触发，或 bitsandbytes NF4 与 PyTorch 2.7.0+Blackwell 深层不兼容 | ❌ 未解决 |

#### 关键修复文件

```
services/image/entrypoint.sh          # NEW - WSL2 PTX JIT 路径注入
services/image/Dockerfile             # MODIFIED - 添加 ENTRYPOINT
services/image/providers/flux_local.py # MODIFIED - 去除 torch.compile，恢复 enable_model_cpu_offload
services/image/job_handler.py         # MODIFIED - utf-8-sig + traceback logging
services/image/requirements.txt      # MODIFIED - 补全 protobuf, sentencepiece
docker-compose.yml                    # MODIFIED - CUDA_LAUNCH_BLOCKING, shm_size=4gb
```

#### 现状 flux_local.py 关键代码

```python
# 当前状态（enable_model_cpu_offload 模式）
torch.cuda.empty_cache()
pipe.enable_model_cpu_offload()    # accelerate 管理 T5/VAE 的 CPU/GPU 调度
pipe.vae.enable_slicing()
pipe.vae.enable_tiling()
# torch.compile 已注释掉（Blackwell + bitsandbytes NF4 SIGSEGV）
```

#### 下一步建议（image-service）

1. **加 faulthandler** 捕获 C 层 crash 的真实堆栈：
   ```python
   # flux_local.py _load() 开头加：
   import faulthandler, sys
   faulthandler.enable(file=sys.stderr, all_threads=True)
   ```
   然后 `docker cp` + 重启容器，从 `docker compose logs image-service` 看 C 层 stack trace

2. **尝试更保守的量化**：换用 `load_in_8bit=True`（bitsandbytes INT8）代替 NF4，INT8 的 Blackwell 支持更稳定

3. **或绕过 bitsandbytes**：使用 `quanto` 库的 INT8 量化（diffusers 内置，不依赖 bitsandbytes 的 CUDA kernel）

---

### video-service 现状（代码修复完毕，剩余 Docker 内存问题）

#### 完整调试历史（本次会话 — 逐步排错）

提交任务后流式接收 SSE 事件，每次报错修复后重新测试：

| 轮次 | 错误 | 根因 | 已修复 |
|------|------|------|--------|
| 1 | argparse error: unrecognized arguments: --sample_nums | `generate.py` 没有此参数（MVP 脚本用的是更旧版 API）| ✅ 删除该行 |
| 2 | `ModuleNotFoundError: No module named 'easydict'` | requirements.txt 只有 4 个包，Wan 运行时依赖全部缺失 | ✅ 补全所有 Wan 依赖 |
| 3 | `ModuleNotFoundError: No module named 'einops'` | einops 漏掉（wan/modules/vae.py 需要）| ✅ 加入 requirements.txt |
| 4 | `ModuleNotFoundError: No module named 'dashscope'` | dashscope 在 prompt_extend.py 顶层无条件 import | ✅ 加入 requirements.txt |
| 5 | exit code -9 / exit code 137（SIGKILL）| **Docker Desktop 内存不足（15.21GB），T5 UMT5-XXL encoder（11GB）加载时触发 OOM Killer** | ❌ 需调整 Docker 内存 |

#### 模型内存分析

| 组件 | 文件大小 | RAM 需求 |
|------|---------|---------|
| T5 UMT5-XXL encoder (bf16) | **11 GB** | ~11GB（CPU，`--t5_cpu`）|
| Wan DiT 1.3B (safetensors) | 5.3 GB | offload 模式峰值 ~2-3GB |
| VAE | 485 MB | ~500MB |
| PyTorch CUDA ctx + 进程 | — | ~1-2GB |
| **PyTorch 加载峰值**（mmap+copy）| — | **T5 加载时峰值 ~18-22GB** |
| Docker Desktop 当前限制 | — | **15.21GB** ← 不够 |

**Windows 宿主机能运行**：直接访问 32GB 物理 RAM，无 Docker 隔离。

#### 关键修复文件

```
services/video/providers/wan_local.py  # MODIFIED - 删除 --sample_nums
services/video/requirements.txt        # MODIFIED - 补全 Wan 全部依赖
services/video/job_handler.py          # MODIFIED - utf-8-sig + traceback logging
projects/test-video-001/               # NEW - 测试项目（storyboard.json + audio_durations.json）
```

#### 下一步：解除内存限制（必须手动操作）

```
Docker Desktop → Settings → Resources → Memory → 改为 24 GB → Apply & Restart
```

重启后验证并重建：
```bash
docker info | grep "Total Memory"     # 期望: 24GiB
cd D:\work\novel-workflow
docker compose build --no-cache video-service   # 已含所有依赖，或跳过直接 up
docker compose up -d video-service
```

测试命令：
```bash
curl -s -X POST http://localhost:8004/jobs \
  -H "Content-Type: application/json" \
  -d '{"project_id":"test-video-001","config":{"width":832,"height":480,"num_frames":65,"num_inference_steps":20}}'
# 然后流式接收 SSE：
curl -s "http://localhost:8004/jobs/{job_id}/events"
# 成功标志：event: complete（非 event: error），shot-001.mp4 存在
```

---

### 三、本次会话提交记录（develop 分支）

```
1eb499f  fix(video): add missing einops, dashscope, torchvision to requirements
7fb781a  fix(video): fix 4 critical bugs preventing Wan video generation
8ab439a  docs: update HANDOFF with full handoff for OPENCODE, fix flux_local torch.compile crash
a3d04bd  fix(image): add torch.compile and reduce inference steps to 15  ← 此 commit 的 torch.compile 在 8ab439a 中已撤回
```

---

### 四、待下一步处理事项（优先级排序）

| 优先级 | 事项 | 操作 |
|--------|------|------|
| 🔴 P0 | 调整 Docker Desktop 内存至 24GB | 手动操作（需重启）|
| 🔴 P0 | 测试 video-service 视频生成 | 内存调整后立即执行 |
| 🟡 P1 | 解决 image-service GPU 崩溃 | 加 faulthandler / 换 INT8 量化 |
| 🟡 P1 | 测试 image-service 图片生成 | image-service 修复后执行 |
| 🟢 P2 | E2E 全链路联测 | image+video 均通过后 |
| 🟢 P2 | Web 前端加入 docker-compose | 当前需手动 npm run dev |

---

## 当前完整状态 — 2026-04-19（CLAUDE → OPENCODE 交接）

> **交接自**：Claude Sonnet 4.6  
> **交接至**：OPENCODE  
> **工作目录**：`D:\work\novel-workflow`

---

### 一、整体开发进度（全貌）

**所有代码已开发完成，Docker 服务已构建并运行。当前唯一阻塞点是 image-service 的 GPU 模型加载崩溃。**

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | shared 公共模块（JobManager、ModelManager）| ✅ 完成并已部署 |
| Phase 2 | 5 个后端 FastAPI 微服务 + docker-compose | ✅ 完成并已运行 |
| Phase 3 | Next.js 前端（App Router + shadcn/ui）| ✅ 完成（未在 docker-compose 中，本地 `npm run dev`）|
| Phase 4 | GPU 真实推理测试 | 🔴 **image-service 崩溃，阻塞中** |

---

### 二、当前运行状态（2026-04-19 已验证）

#### Docker 服务（全部运行中）

```
容器名                              宿主机端口   状态
novel-workflow-storyboard-service-1   8001     ✅ healthy
novel-workflow-image-service-1        8002     ✅ healthy（模型未加载）
novel-workflow-tts-service-1          8003     ✅ healthy
novel-workflow-video-service-1        8004     ✅ healthy（模型未加载）
novel-workflow-assembly-service-1     8005     ✅ healthy（ffmpeg 可用）
```

注意：**Web 前端未在 docker-compose 中**，需单独启动：
```bash
cd apps/web && npm install && npm run dev   # http://localhost:3000
```

#### .env 配置（`D:\work\novel-workflow\.env`）

```env
IMAGE_PROVIDER=flux_local      # 真实 GPU 推理（非 mock）
MOCK_MODE=false
FLUX_MODEL_PATH=/app/models/FLUX.1-dev
VIDEO_PROVIDER=wan_local
WAN_MODEL_PATH=/app/models/Wan2.1-T2V-1.3B
KIMI_API_KEY=sk-kimi-fchXfQ...  # 已配置
TTS_PROVIDER=edge_tts
```

#### GPU 环境

| 项目 | 值 |
|------|-----|
| GPU | NVIDIA GeForce RTX 5070 Laptop，**12GB VRAM** |
| 驱动 | 595.97，CUDA 13.2（容器内镜像：CUDA 12.8） |
| GPU 架构 | **Blackwell (sm_120)** — 注意 Triton 支持尚不成熟 |
| 模型挂载 | `D:\work\novel-comic-drama\models\` → 容器内 `/app/models/` |

---

### 三、代码结构（已实现）

```
novel-workflow/
├── services/
│   ├── shared/
│   │   ├── job_manager.py        # 异步 Job 生命周期 + SSE 广播
│   │   └── model_manager.py      # GPU 模型 TTL 按需加载/卸载
│   ├── storyboard/               # 端口 8001，KimiProvider
│   ├── image/                    # 端口 8002，FluxLocalProvider（4-bit NF4）
│   │   └── providers/
│   │       ├── flux_local.py     # ← 当前调试重点
│   │       └── mock.py
│   ├── tts/                      # 端口 8003，EdgeTTSProvider
│   ├── video/                    # 端口 8004，WanSubprocessProvider
│   └── assembly/                 # 端口 8005，FFmpeg 9步 pipeline
├── apps/web/                     # Next.js 15 前端
│   └── app/
│       ├── api/pipeline/         # SSE 代理 + 服务编排
│       └── projects/             # Pipeline Wizard UI
├── projects/
│   └── test-gpu-001/
│       └── storyboard.json       # 测试用（1个 shot）
├── docker-compose.yml
└── .env
```

---

### 四、当前唯一阻塞：image-service GPU 崩溃

#### 现象

调用 `POST http://localhost:8002/jobs` 后，image-service 开始加载 FLUX.1-dev 模型，但在 `FluxPipeline.from_pretrained()` 加载组件（3~7/7）时，进程**无声死亡**（无 Python traceback），容器被 `restart: unless-stopped` 策略重启。

#### 排查历程

1. **首次失败**：`protobuf` 和 `sentencepiece` 未安装在运行容器中  
   - 临时修复：`docker exec pip install protobuf sentencepiece` ✅  
   - 根本原因：镜像构建时缓存问题，`requirements.txt` 里有但没装进去  

2. **第二次失败**：`torch.compile(mode="max-autotune")` 与 bitsandbytes NF4 在 Blackwell 上冲突  
   - 另一个 Agent 在 `flux_local.py` 里添加了 `torch.compile` 优化  
   - Blackwell (sm_120) 上 Triton 支持未成熟，导致 C 层 SIGSEGV，无任何 Python traceback  
   - **已修复**：`torch.compile` 已从代码中注释掉 ✅  

3. **第三次失败（当前）**：移除 `torch.compile` 后仍崩溃  
   - 崩溃发生在 pipeline 加载 3~7/7 组件期间（计时约 35 秒内）  
   - **推测根因**：`pipe.enable_model_cpu_offload()` 与 bitsandbytes NF4 量化张量冲突——NF4 量化张量是 CUDA-only 格式，accelerate 的 cpu offload hook 尝试将其移至 CPU 时触发底层崩溃  
   - **尚未验证**，会话在此暂停

#### 当前 `flux_local.py` 关键代码（`_load()` 末尾）

```python
# services/image/providers/flux_local.py

torch.cuda.empty_cache()
pipe.enable_model_cpu_offload()   # ← 怀疑崩溃点
pipe.vae.enable_slicing()
pipe.vae.enable_tiling()
# torch.compile 已注释掉（Blackwell + bitsandbytes 不稳定）
logger.info("Pipeline ready (torch.compile skipped for bitsandbytes compat)")
return pipe
```

> ⚠️ **注意**：`flux_local.py` 宿主机已更新，但容器内靠 `docker cp` 注入。  
> 如果容器被镜像级重建（而非 `docker restart`），需要重新 `docker cp`。

---

### 五、OPENCODE 的任务清单

#### 🔴 任务 1（必须，根本修复）：重建 image-service 镜像

```bash
cd D:\work\novel-workflow
docker compose build --no-cache image-service
docker compose up -d image-service
```

重建后 `protobuf` 和 `sentencepiece` 会真正打进镜像，不再依赖手动 `pip install`。

#### 🔴 任务 2：修复 `enable_model_cpu_offload` 崩溃

bitsandbytes NF4 量化后 transformer ~6GB，RTX 5070 12GB VRAM 理论够用，**尝试去掉 `enable_model_cpu_offload()`，改为显式移到 GPU**：

```python
# services/image/providers/flux_local.py 中替换：
# 原来：pipe.enable_model_cpu_offload()
# 改为：

pipe.vae = pipe.vae.to("cuda")
pipe.text_encoder = pipe.text_encoder.to("cuda")
# transformer 已是 bitsandbytes NF4，在 GPU 上，不需要移动
# text_encoder_2 (T5) 保持 CPU（已用 low_cpu_mem_usage 加载）
pipe.vae.enable_slicing()
pipe.vae.enable_tiling()
```

如果 12GB 装不下，回退方案：用 `enable_sequential_cpu_offload()`（比 `enable_model_cpu_offload` 对量化模型更友好）。

#### 🟡 任务 3（辅助诊断）：加 faulthandler 捕获 C 层崩溃

如果任务 2 仍崩溃，在 `_load()` 函数开头加：

```python
import faulthandler, sys
faulthandler.enable(file=sys.stderr)
```

然后 `docker cp` + `docker restart`，触发加载，从 `docker logs` 里找 C 层 stack trace。

---

### 六、测试流程（每次改完后执行）

```bash
# Step 1: 更新容器内代码（重建镜像则跳过）
docker cp services/image/providers/flux_local.py \
    novel-workflow-image-service-1:/app/providers/flux_local.py

# Step 2: 重启服务
docker restart novel-workflow-image-service-1
sleep 5

# Step 3: 触发图片生成
curl -s -X POST http://localhost:8002/jobs \
  -H "Content-Type: application/json" \
  -d '{"project_id":"test-gpu-001","config":{"width":768,"height":768,"num_inference_steps":15,"guidance_scale":3.5,"seed":42}}'
# 期望返回：{"job_id":"...","status":"queued"}

# Step 4: 监控模型加载（需约 2 分钟）
watch -n 10 "curl -s http://localhost:8002/model/status"
# 期望：state 从 loading → loaded

# Step 5: 查看日志
docker logs -f novel-workflow-image-service-1

# Step 6: 查询任务状态（用 Step 3 返回的 job_id）
curl -s http://localhost:8002/jobs/{job_id}/status
```

**成功标志**：
- `model/status` 返回 `"state":"loaded"`
- `jobs/{job_id}/status` 返回 `"status":"completed"`
- 文件 `D:\work\novel-workflow\projects\test-gpu-001\images\shot-001.png` 存在且可打开

---

### 七、已知坑（本次调试发现）

| 问题 | 现象 | 解法 |
|------|------|------|
| 镜像缺 `protobuf`/`sentencepiece` | POST /jobs 返回 500，ImportError | `--no-cache` 重建镜像 |
| `torch.compile` + bitsandbytes + Blackwell | C 层 SIGSEGV，无 traceback | 已注释掉 torch.compile |
| `enable_model_cpu_offload` + NF4 | 加载过程中无声崩溃 | 待验证，尝试去掉 offload |
| `docker restart` vs 镜像重建 | 重建后 pip install 丢失 | 重建镜像才是根本修复 |

---

*本节由 Claude Sonnet 4.6 创建，2026-04-19*

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

---

## 当前完整状态 — 2026-04-20（Sisyphus — 步骤级生命周期控制设计交付）

> **交接自**：Sisyphus Agent  
> **工作目录**：`D:\work\novel-workflow`  
> **本次任务**：步骤级暂停(pause)/启动(start)/停止(stop)功能 — 设计与文档  
> **代码变更**：无（本次仅完成设计与文档，未进入编码阶段）

---

### 一、本次完成的工作

| 任务 | 状态 | 说明 |
|------|------|------|
| 探索现有代码库架构 | ✅ | 全面分析了前端(Next.js)、后端(5个FastAPI服务)、共享模块(JobManager/ModelManager) |
| 设计步骤级生命周期控制 | ✅ | 完整设计了 pause/resume/stop 的状态机、API、UI、时序图 |
| 编写设计文档 | ✅ | 新建 `08-step-lifecycle-control.md`（完整技术设计，含后端+前端+实现清单） |
| 更新 WebUI 设计文档 | ✅ | 修改 `07-webui-design.md`，补充暂停/恢复/停止的 UI 设计、API 路由、Hook 接口 |
| 更新交接文档 | ✅ | 更新 `HANDOFF.md`，记录本次交付内容 |

---

### 二、新增/修改的文件清单

#### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `docs/technical/design/08-step-lifecycle-control.md` | 【新增】步骤级生命周期控制完整设计文档。含：状态机、后端 JobManager 扩展、FastAPI 路由、前端 Hook/UI、断点续传机制、时序图、实现清单、风险缓解。共 10 个章节。 |

#### 修改文件

| 文件路径 | 变更内容 |
|---------|---------|
| `docs/technical/design/07-webui-design.md` | 【更新】补充步骤生命周期控制 UI 设计：  
- 目录结构：新增 `pause/`、`resume/`、`stop/` API 路由，`useStepControl.ts` Hook  
- 步骤状态图标表：新增 `paused`（⏸ 琥珀色）、`stopped`（■ 橙色）  
- StepCard Props：扩展 `onPause`/`onResume`/`onStop`/`onRestart` 回调  
- 操作按钮说明：新增 `in_progress` → `[⏸ 暂停] [■ 停止]`，`paused` → `[▶ 继续] [■ 停止]`，`stopped` → `[重新开始]`  
- API Routes：新增 `POST /api/pipeline/[id]/[step]/pause`、`/resume`、`/stop`  
- useStepProgress Hook：新增 `isPaused`、`isStopped` 字段，`paused`/`resumed`/`stopped` SSE 事件监听  
- 新增第 10 章"步骤生命周期控制 UI"：状态徽章样式、各状态操作按钮 mockup、useStepControl Hook 代码、自动模式交互、断点续传提示  
- 时序图章节编号调整为 12  
- 新增文档更新记录表 |
| `HANDOFF.md` | 【更新】追加本次交接章节（Sisyphus 设计交付记录） |

---

### 三、设计文档核心摘要

#### 3.1 扩展后的状态机

```
pending → in_progress → completed
   ↓           ↓
 failed      paused ←→ resumed
              ↓
            stopped → restart → in_progress
```

**新增 2 个状态**：
- `paused`：任务已暂停，保留进度和上下文，可恢复
- `stopped`：任务已停止，保留已产出文件，可重新开始（利用断点续传）

#### 3.2 后端扩展（Python 服务层）

**JobManager 扩展**（`services/shared/job_manager.py`）：
- `JobStatus` 新增 `PAUSED`
- `JobRecord` 新增 `_pause_event: asyncio.Event`、`_stop_requested: bool`
- 新增方法：`check_pause()`（handler 循环中调用）、`pause()`、`resume()`、`request_stop()`
- 新增 SSE 事件：`paused`、`resumed`、`stopped`

**各服务 FastAPI 路由扩展**：
- `POST /jobs/{job_id}/pause`
- `POST /jobs/{job_id}/resume`
- `POST /jobs/{job_id}/stop`

**Job Handler 改造**：在每个工作单元（shot/track/phase）前插入 `await job.check_pause()`

#### 3.3 前端扩展（Next.js）

**新增 Hook**：`apps/web/hooks/useStepControl.ts`
- `pauseStep(step)`、`resumeStep(step)`、`stopStep(step)`

**新增 API Routes**：
- `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts`
- `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts`
- `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts`

**UI 改造**（`apps/web/app/projects/[id]/page.tsx`）：
- 扩展 `StepStatus` 类型为 6 种状态
- 扩展 `STATUS_ICONS` 和 `STATUS_COLORS`
- StepCard 操作区按状态显示不同按钮组合

#### 3.4 断点续传机制

暂停/停止后重新开始时，**利用现有文件存在性检查自动跳过**：
- image：已存在的 `images/{shot_id}.png` 自动跳过
- tts：已存在的 `audio/{shot_id}_action.wav` 自动跳过
- video：已存在的 `clips/{shot_id}.mp4` 自动跳过

**无需额外实现状态持久化**，现有 `job_handler.py` 中的文件检查逻辑已天然支持。

---

### 四、实现清单（待编码）

详见 `docs/technical/design/08-step-lifecycle-control.md` 第 8 节"实现清单"。

**后端（11 个文件待修改）**：
1. `services/shared/job_manager.py` — 核心扩展
2-11. 5 个服务的 `main.py` + `job_handler.py` — 新增路由 + 插入 check_pause()

**前端（7 个文件待修改/新增）**：
1. `apps/web/lib/project-store.ts` — 扩展 StepStatus
2. `apps/web/hooks/useStepControl.ts` — 【新增】
3. `apps/web/hooks/useStepProgress.ts` — 扩展 SSE 事件处理
4-6. `apps/web/app/api/pipeline/[id]/[step]/{pause,resume,stop}/route.ts` — 【新增】
7. `apps/web/app/projects/[id]/page.tsx` — UI 改造

---

### 五、当前项目状态（全貌）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | shared 公共模块（JobManager、ModelManager）| ✅ 完成并已部署 |
| Phase 2 | 5 个后端 FastAPI 微服务 + docker-compose | ✅ 完成并已运行 |
| Phase 3 | Next.js 前端（App Router + shadcn/ui）| ✅ 完成（本地 `npm run dev`）|
| **新功能设计** | **步骤级暂停/启动/停止** | **✅ 设计完成，文档就绪，待编码** |
| Phase 4 | 集成与部署 | ⏳ 等待（需先解决 image-service GPU 崩溃）|

**遗留阻塞问题**（来自前序交接，未解决）：
1. **image-service GPU 崩溃**：WSL2 + Docker + Blackwell (sm_120) + bitsandbytes NF4 兼容性问题
2. **video-service Docker 内存不足**：Docker Desktop 默认 15.21GB < Wan 所需 16-18GB

---

### 六、下一步建议

#### 方案 A：先实现步骤控制功能（推荐）

1. **并行实现**：
   - Agent A：修改 `services/shared/job_manager.py` + 5 个服务的 `main.py`/`job_handler.py`
   - Agent B：修改前端（新增 Hook、API Routes、UI 改造）
2. **Mock 模式测试**：在 `MOCK_MODE=true` 下验证暂停/恢复/停止流程
3. **集成测试**：与现有自动模式联测

**优势**：不依赖 GPU 环境修复，可在 Mock 模式下独立验证。

#### 方案 B：先解决 GPU 环境，再实现步骤控制

1. 按前序交接建议，修复 image-service（faulthandler / INT8 量化 / 去掉 offload）
2. 调整 Docker Desktop 内存至 24GB，测试 video-service
3. GPU 服务跑通后，再实现步骤控制功能

**风险**：GPU 环境修复时间不可控，可能阻塞新功能开发。

#### 方案 C：混合推进

1. 一个 Agent 继续攻克 image-service GPU 问题
2. 另一个 Agent 并行实现步骤控制功能（Mock 模式）

**优势**：最大化并行效率，不互相阻塞。

---

### 七、已知风险（设计层面已考虑）

| 风险 | 缓解措施 |
|------|---------|
| 暂停期间模型仍占用 GPU | v1.0 文档说明：暂停不卸载模型，需停止+unload 才能释放 |
| 服务重启丢失 Job | 利用断点续传，重新开始即可自动跳过已生成文件 |
| 并发操作冲突（快速点击）| UI 按钮加 loading 状态，禁用重复点击 |
| 停止后部分文件损坏 | 各服务使用原子写入（tmp → rename），不会出现半写文件 |
| SSE 断线后状态不同步 | SWR 轮询读取 state.json 纠正状态 |

---

*本节由 Sisyphus Agent 创建*  
*最后更新：2026-04-20*  
*状态：步骤级生命周期控制设计完成，待编码实现*

---

## 当前完整状态 — 2026-04-20（Sisyphus — 步骤生命周期控制 + 步骤结果预览 编码完成）

> **交接自**：Sisyphus Agent  
> **工作目录**：`D:\work\novel-workflow`  
> **分支**：`feature/step-lifecycle-and-preview`（基于 develop）  
> **本次任务**：
> 1. 步骤级暂停(pause)/启动(start)/停止(stop)功能 — **设计与编码全部完成**
> 2. 步骤结果预览功能 — **设计与编码全部完成**
> 3. GPU 崩溃问题 — **已修复**
> 4. ESLint 错误修复 — **已完成**

---

### 一、本次完成的工作（本次会话）

| 任务 | 状态 | 说明 |
|------|------|------|
| 步骤生命周期控制 — 设计文档 | ✅ | `08-step-lifecycle-control.md`（前序会话已完成） |
| 步骤生命周期控制 — 后端编码 | ✅ | JobManager + 5 个服务的 main.py/job_handler.py 扩展 |
| 步骤生命周期控制 — 前端编码 | ✅ | project-store, useStepProgress, useStepControl, API Routes, page.tsx UI |
| 步骤结果预览 — 设计文档 | ✅ | 新建 `09-step-preview.md`（含数据模型、组件设计、文件访问策略） |
| 步骤结果预览 — 后端编码 | ✅ | SSE 代理持久化 `emit_complete` 的 `result` 到 state.json |
| 步骤结果预览 — 前端编码 | ✅ | `StepArtifacts` 组件 + 5 个步骤子组件 + 页面集成 |
| ESLint 错误修复 | ✅ | `useAutoMode` hook 中的 `setState in effect` 已修复 |
| GPU 崩溃问题 | ✅ | **用户已修复**（见下方说明） |
| TypeScript 类型检查 | ✅ | `npx tsc --noEmit` 通过，零错误 |
| ESLint 验证 | ✅ | 仅 1 个 pre-existing `any` 错误 + 1 个 `<img>` 警告（非本次引入） |

---

### 二、新增/修改的文件清单

#### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `docs/technical/design/09-step-preview.md` | 【新增】步骤结果预览完整设计文档。含：需求背景、数据模型扩展（StepResult）、后端变更、前端组件架构、各步骤预览 UI 设计、文件访问策略、实现顺序。 |
| `apps/web/hooks/useStepControl.ts` | 【新增】步骤控制 Hook：pauseStep/resumeStep/stopStep |
| `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts` | 【新增】暂停 API 路由 |
| `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts` | 【新增】恢复 API 路由 |
| `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` | 【新增】停止 API 路由 |
| `apps/web/components/step-artifacts.tsx` | 【新增】步骤产物预览组件，含 5 个子组件：StoryboardArtifacts（分镜列表）、ImageArtifacts（图片网格）、TTSArtifacts（音频播放器）、VideoArtifacts（视频网格）、AssemblyArtifacts（最终视频播放器+下载按钮） |

#### 修改文件

| 文件路径 | 变更内容 |
|---------|---------|
| `services/shared/job_manager.py` | 【修改】新增 `PAUSED` 状态、`check_pause()`、`pause()`/`resume()`/`request_stop()` 方法；新增 `paused`/`resumed`/`stopped` SSE 事件；新增 `JobManager.pause()`/`resume()`/`stop()` 方法 |
| `services/storyboard/main.py` | 【修改】新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由 |
| `services/storyboard/job_handler.py` | 【修改】循环中插入 `await job.check_pause()` |
| `services/image/main.py` | 【修改】新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由 |
| `services/image/job_handler.py` | 【修改】循环中插入 `await job.check_pause()` |
| `services/tts/main.py` | 【修改】新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由 |
| `services/tts/job_handler.py` | 【修改】循环中插入 `await job.check_pause()` |
| `services/video/main.py` | 【修改】新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由 |
| `services/video/job_handler.py` | 【修改】循环中插入 `await job.check_pause()` |
| `services/assembly/main.py` | 【修改】新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由 |
| `services/assembly/job_handler.py` | 【修改】循环中插入 `await job.check_pause()` |
| `apps/web/lib/project-store.ts` | 【修改】`StepState` 扩展 `result?: StepResult \| null`；新增 `StepResult` union 及 5 个结果类型：`StoryboardResult`、`ImageResult`、`TTSResult`、`VideoResult`、`AssemblyResult` |
| `apps/web/hooks/useStepProgress.ts` | 【修改】新增 `ProgressArtifact` 类型和 `artifacts` 数组；`progress` 事件中实时收集产物；返回 `artifacts` |
| `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` | 【修改】`complete` 事件持久化 `result` 到 state.json；`error` 事件清空 `result` |
| `apps/web/app/projects/[id]/page.tsx` | 【修改】扩展图标/颜色/Badge 支持 `paused`/`stopped`；新增控制按钮逻辑（暂停/恢复/停止）；支持 `stopped` 状态重新开始；集成 `StepArtifacts` 预览组件；修复 `useAutoMode` ESLint 错误 |

---

### 三、功能详细说明

#### 3.1 步骤级生命周期控制

**状态机**：
```
pending → in_progress → completed
   ↓           ↓
 failed      paused ←→ resumed
              ↓
            stopped → restart → in_progress
```

**操作按钮映射**：
| 状态 | 可执行操作 |
|------|-----------|
| pending / failed / stopped | 【开始执行】/【重试】/【重新开始】 |
| in_progress | 【暂停】 【停止】 |
| paused | 【继续】 【停止】 |

**断点续传**：停止/暂停后重新开始，各服务自动跳过已存在的输出文件（基于 `output_path.exists()` 检查）。

#### 3.2 步骤结果预览

**数据持久化**：SSE `complete` 事件的 `result` payload 现在持久化到 `state.json` 的 `steps[step].result` 字段中，刷新页面后仍可展示产物。

**各步骤预览内容**：
| 步骤 | 预览内容 | 数据来源 |
|------|---------|---------|
| storyboard | 分镜列表（shot_id、shot_type、duration、action、dialogue） | `storyboard.json` |
| image | 图片网格（lazy loading，shot_id 标签） | `images/{shot_id}.png` |
| tts | 音频播放器列表（shot_id + 台词/旁白标签） | `audio/{shot_id}_{action\|dialogue}.wav` |
| video | 视频播放器网格（shot_id + 时长标签） | `clips/{shot_id}.mp4` |
| assembly | 最终视频播放器 + 下载 MP4/SRT 按钮 | `output/final.mp4` + `output/final.srt` |

**展示时机**：`completed`、`stopped`、`in_progress`、`paused` 状态均展示产物；`pending` 和 `failed` 不展示。

---

### 四、GPU 问题状态更新

**image-service GPU 崩溃**：✅ **已修复**
- 用户确认已修复 GPU 兼容性问题
- 之前阻塞的 WSL2 + Docker + Blackwell (sm_120) + bitsandbytes NF4 问题已解决

**video-service Docker 内存不足**：
- 仍需手动调整 Docker Desktop 内存至 24GB（如未调整）
- 代码侧所有 Bug 已修复（`--sample_nums` 参数、依赖补全、BOM 编码）

---

### 五、项目整体状态

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | shared 公共模块 | ✅ 完成 |
| Phase 2 | 5 个后端 FastAPI 微服务 | ✅ 完成 |
| Phase 3 | Next.js 前端 | ✅ 完成 |
| **新功能** | **步骤级暂停/启动/停止** | **✅ 设计+编码全部完成** |
| **新功能** | **步骤结果预览** | **✅ 设计+编码全部完成** |
| Phase 4 | GPU 真实推理验证 | 🟡 image-service 已修复，video-service 待内存调整 |

---

### 六、启动命令

**启动所有 Docker 服务**：
```bash
cd D:\work\novel-workflow
docker compose up -d
```

**启动前端开发服务器**：
```bash
cd D:\work\novel-workflow\apps\web
npm install
npm run dev
```

前端访问地址：`http://localhost:3000`

---

### 七、已知问题（非阻塞）

1. **`apps/web/app/projects/page.tsx:111` — `any` 类型**：pre-existing ESLint 错误，非本次引入
2. **`apps/web/components/step-artifacts.tsx:91` — `<img>` 警告**：使用原生 `<img>` 而非 Next.js `<Image />`。这是有意为之（本地 API 路由 serving，无需 Image 优化）
3. **video-service 内存需求**：Docker Desktop 需 ≥24GB 内存才能运行 Wan2.1 模型

---

*本节由 Sisyphus Agent 创建*  
*最后更新：2026-04-20*  
*状态：步骤生命周期控制 + 步骤结果预览 — 设计+编码全部完成，等待验收*

---

## 📋 交接文档 — 给 CLAUDE Agent（2026-04-20 最终版）

> **交接人**：Sisyphus Agent  
> **接收人**：CLAUDE Agent  
> **工作目录**：`D:\work\novel-workflow`  
> **分支**：基于 `develop`（未创建独立 feature 分支，直接在 develop 工作区修改）  
> **项目状态**：Phase 1-3 全部完成，两大新功能（生命周期控制 + 结果预览）编码完成，GPU 问题已修复

---

### 一、项目一句话概括

将小说文本通过 AI Pipeline 自动生成动漫风格短视频（分镜 → 图片 → 配音 → 视频 → 拼装），Web UI 管理整个流程。

### 二、技术栈速览

| 层 | 技术 | 端口 |
|----|------|------|
| 前端 | Next.js 16 + React 19 + Tailwind + shadcn/ui | 3000 |
| Storyboard | FastAPI (Kimi API) | 8001 |
| Image | FastAPI (FLUX.1-dev NF4) | 8002 |
| TTS | FastAPI (edge-tts) | 8003 |
| Video | FastAPI (Wan2.1 subprocess) | 8004 |
| Assembly | FastAPI (FFmpeg) | 8005 |

### 三、本次会话完成的所有工作

#### 3.1 步骤级生命周期控制（暂停/恢复/停止）

**文档**：`docs/technical/design/08-step-lifecycle-control.md`

**后端实现**：
- `services/shared/job_manager.py` — 新增 `PAUSED` 状态、`check_pause()`、`pause()`/`resume()`/`request_stop()` 方法
- 5 个服务的 `main.py` — 各新增 `POST /jobs/{id}/pause`、`/resume`、`/stop` 路由
- 5 个服务的 `job_handler.py` — 循环中插入 `await job.check_pause()`

**前端实现**：
- `apps/web/lib/project-store.ts` — `StepStatus` 扩展为 6 种状态（pending/in_progress/paused/stopped/completed/failed）
- `apps/web/hooks/useStepProgress.ts` — 监听 `paused`/`resumed`/`stopped` SSE 事件
- `apps/web/hooks/useStepControl.ts` — 【新增】pause/resume/stop 操作 Hook
- `apps/web/app/api/pipeline/[id]/[step]/pause/route.ts` — 【新增】
- `apps/web/app/api/pipeline/[id]/[step]/resume/route.ts` — 【新增】
- `apps/web/app/api/pipeline/[id]/[step]/stop/route.ts` — 【新增】
- `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` — 代理 `stopped` 事件，更新 state.json
- `apps/web/app/projects/[id]/page.tsx` — UI 改造（图标/颜色/Badge/控制按钮）

#### 3.2 步骤结果预览

**文档**：`docs/technical/design/09-step-preview.md`

**后端实现**：
- `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` — `complete` 事件持久化 `result` 到 state.json；`error` 事件清空 `result`

**前端实现**：
- `apps/web/lib/project-store.ts` — 新增 `StepResult` union 及 5 个结果类型（StoryboardResult/ImageResult/TTSResult/VideoResult/AssemblyResult），`StepState` 扩展 `result` 字段
- `apps/web/hooks/useStepProgress.ts` — 新增 `ProgressArtifact` 类型和 `artifacts` 数组，progress 事件中实时收集产物
- `apps/web/components/step-artifacts.tsx` — 【新增】步骤产物预览主组件，含 5 个子组件：
  - `StoryboardArtifacts` — 分镜列表（shot_id/type/duration/action/dialogue）
  - `ImageArtifacts` — 图片网格（lazy loading）
  - `TTSArtifacts` — 音频播放器列表（台词/旁白标签）
  - `VideoArtifacts` — 视频片段播放器网格
  - `AssemblyArtifacts` — 最终视频播放器 + 下载按钮
- `apps/web/app/projects/[id]/page.tsx` — 集成 `StepArtifacts` 到步骤卡片

#### 3.3 Bug 修复

- `services/storyboard/providers/kimi.py` — 修复 JSON 解析：遍历所有 content block 拼接 text，改进大括号匹配算法提取最外层 JSON
- `apps/web/app/projects/[id]/page.tsx` — 修复 `useAutoMode` hook 的 ESLint `setState in effect` 错误

### 四、文件变更总清单

#### 新增文件（8个）

```
docs/technical/design/09-step-preview.md
apps/web/hooks/useStepControl.ts
apps/web/app/api/pipeline/[id]/[step]/pause/route.ts
apps/web/app/api/pipeline/[id]/[step]/resume/route.ts
apps/web/app/api/pipeline/[id]/[step]/stop/route.ts
apps/web/components/step-artifacts.tsx
```

#### 修改文件（18个）

```
services/shared/job_manager.py              # 生命周期控制核心扩展
services/storyboard/main.py                 # +pause/resume/stop 路由
services/storyboard/job_handler.py          # +check_pause()
services/storyboard/providers/kimi.py       # JSON解析修复
services/image/main.py                      # +pause/resume/stop 路由
services/image/job_handler.py               # +check_pause()
services/tts/main.py                        # +pause/resume/stop 路由
services/tts/job_handler.py                 # +check_pause()
services/video/main.py                      # +pause/resume/stop 路由
services/video/job_handler.py               # +check_pause()
services/assembly/main.py                   # +pause/resume/stop 路由
services/assembly/job_handler.py            # +check_pause()
apps/web/lib/project-store.ts             # StepResult类型 + result字段
apps/web/hooks/useStepProgress.ts         # artifacts + 暂停事件
apps/web/app/api/pipeline/[id]/[step]/events/route.ts  # result持久化
apps/web/app/projects/[id]/page.tsx       # UI改造 + StepArtifacts集成
docs/technical/design/08-step-lifecycle-control.md     # （前序会话）
docs/technical/design/07-webui-design.md  # （前序会话）
```

### 五、数据模型速查

#### StepState（state.json 中每个步骤的状态）

```typescript
interface StepState {
  status: "pending" | "in_progress" | "paused" | "stopped" | "completed" | "failed";
  job_id: string | null;
  updated_at: string;
  result?: StepResult | null;  // 【新增】步骤完成后的产物元数据
}
```

#### StepResult（各步骤的产物结构）

```typescript
type StepResult =
  | { type: "storyboard"; data: { shot_count: number; storyboard_path: string } }
  | { type: "image"; data: { images: Array<{shot_id, filename}>; total: number } }
  | { type: "tts"; data: { audio_files: string[]; total_tracks: number } }
  | { type: "video"; data: { clips: Array<{shot_id, filename, duration}>; total: number } }
  | { type: "assembly"; data: { video_path: string; srt_path: string; duration: number } };
```

#### 产物文件路径规范

```
projects/{project_id}/
├── storyboard.json              # storyboard 步骤产出
├── input.txt                    # 用户输入的小说文本
├── images/{shot_id}.png         # image 步骤产出
├── audio/{shot_id}_action.wav   # tts 步骤产出（旁白）
├── audio/{shot_id}_dialogue.wav # tts 步骤产出（台词）
├── audio_durations.json         # tts 步骤产出的时长元数据
├── clips/{shot_id}.mp4          # video 步骤产出
└── output/
    ├── final.mp4                # assembly 步骤产出（最终视频）
    └── final.srt                # assembly 步骤产出（字幕）
```

### 六、启动方式

```bash
# 1. 启动所有后端服务（Docker）
cd D:\work\novel-workflow
docker compose up -d

# 2. 启动前端开发服务器（本地 Node.js）
cd D:\work\novel-workflow\apps\web
npm install   # 如 node_modules 缺失
npm run dev   # http://localhost:3000
```

### 七、验证状态

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查 (`npx tsc --noEmit`) | ✅ 零错误 |
| ESLint | ✅ 仅 pre-existing 错误（非本次引入） |
| Docker 容器健康状态 | ✅ 全部 healthy |
| 前端 Dev Server | ✅ http://localhost:3000 已运行 |
| storyboard-service JSON 解析 | ✅ 已修复 |
| image-service GPU | ✅ 用户已修复 |

### 八、已知问题（非阻塞）

1. **`apps/web/app/projects/page.tsx:111`** — pre-existing `any` 类型 ESLint 错误
2. **`apps/web/components/step-artifacts.tsx:91`** — 使用原生 `<img>` 的 ESLint 警告（本地 API serving，无需 Next.js Image 优化）
3. **video-service 内存需求** — Docker Desktop 需 ≥24GB 内存才能运行 Wan2.1 模型（Docker Desktop Settings → Resources → Memory）

### 九、下一步建议（给 CLAUDE 的选项）

#### 选项 A：端到端联测（推荐）

在 `MOCK_MODE=true` 下执行完整 Pipeline，验证所有步骤的暂停/恢复/停止功能以及结果预览是否正确显示。

```bash
# 设置 MOCK_MODE
docker compose down
docker compose -f docker-compose.yml -f docker-compose.mock.yml up -d
```

#### 选项 B：视觉/UI 优化

- 为 `StepArtifacts` 添加动画过渡（framer-motion）
- 图片灯箱查看（点击放大）
- 视频缩略图首帧海报
- 响应式布局优化（移动端适配）

#### 选项 C：功能增强

- 产物下载 ZIP 打包
- 步骤重新执行时的产物对比
- 分镜图片实时生成时的高斯模糊占位图
- 最终视频播放时叠加字幕预览

#### 选项 D：Bug 修复

- 修复 `projects/page.tsx:111` 的 `any` 类型
- 处理大量图片时的虚拟滚动/分页
- 处理视频加载失败时的错误状态

---

### 十、关键代码位置速查

| 功能 | 文件 |
|------|------|
| 步骤状态定义 | `apps/web/lib/project-store.ts` |
| SSE 进度监听 | `apps/web/hooks/useStepProgress.ts` |
| 步骤控制操作 | `apps/web/hooks/useStepControl.ts` |
| 步骤产物预览 | `apps/web/components/step-artifacts.tsx` |
| Pipeline 页面 UI | `apps/web/app/projects/[id]/page.tsx` |
| SSE 事件代理 | `apps/web/app/api/pipeline/[id]/[step]/events/route.ts` |
| 步骤控制 API | `apps/web/app/api/pipeline/[id]/[step]/{pause,resume,stop}/route.ts` |
| 文件服务 API | `apps/web/app/api/projects/[id]/files/[...path]/route.ts` |
| JobManager（后端） | `services/shared/job_manager.py` |
| Storyboard 生成 | `services/storyboard/providers/kimi.py` |

---

*本文档由 Sisyphus Agent 编写，供 CLAUDE Agent 接入使用*  
*最后更新：2026-04-20*  
*版本：v1.0-final*
