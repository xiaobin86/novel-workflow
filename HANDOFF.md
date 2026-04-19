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

## 当前完整状态 — 2026-04-20（CLAUDE 更新）

> **工作目录**：`D:\work\novel-workflow`  
> **更新时间**：2026-04-20

---

### image-service 现状（GPU 崩溃，暂停调试）

#### 已完成的修复

| 修复 | 文件 | 内容 |
|------|------|------|
| ✅ PTX JIT 修复 | `services/image/entrypoint.sh` | 动态发现 `/usr/lib/wsl/drivers/*/libnvidia-ptxjitcompiler.so.1` 并注入 LD_LIBRARY_PATH |
| ✅ Dockerfile 更新 | `services/image/Dockerfile` | 添加 ENTRYPOINT ["/entrypoint.sh"] |
| ✅ docker-compose.yml | 同上 | 添加 CUDA_LAUNCH_BLOCKING=1、PYTORCH_CUDA_ALLOC_CONF、shm_size=4gb |
| ✅ 去除 torch.compile | `services/image/providers/flux_local.py` | Blackwell+bitsandbytes NF4 SIGSEGV 根因 |
| ✅ BOM 修复 | `services/image/job_handler.py` | encoding="utf-8-sig" |
| ✅ 错误日志 | `services/image/job_handler.py` | traceback.format_exc() |
| ✅ enable_model_cpu_offload | `services/image/providers/flux_local.py` | 用 accelerate 管理 T5/VAE 设备调度，避免 cpu/cuda 设备不匹配 |

#### 仍存在的问题

- **模型加载仍崩溃**：每次 load 大约 1-2 分钟后无声死亡（无 Python traceback），容器重启
- 推测根因：WSL2 + Docker + Blackwell (sm_120) + bitsandbytes NF4 存在深层兼容性问题
- entrypoint.sh 已注入 PTX JIT 路径，但崩溃仍然发生（可能是 sm_120 native kernel 缺失的其他表现）
- **建议**：暂停 image-service，先测通 video-service，之后再回头攻克 image-service

---

### video-service 现状（已发现 4 个 Bug，已修复）

#### 发现的 Bug（全部已修复，待测试）

| Bug | 文件 | 描述 | 严重性 |
|-----|------|------|--------|
| ✅ `--sample_nums` 无效参数 | `wan_local.py` | generate.py 不接受此参数，subprocess 立即退出 | 🔴 致命 |
| ✅ 缺少 Wan 依赖 | `requirements.txt` | easydict/imageio/diffusers 等未包含，subprocess Python 无法运行 generate.py | 🔴 致命 |
| ✅ UTF-8 BOM 编码 | `job_handler.py` | storyboard.json 有 BOM，encoding="utf-8" 解析失败 | 🔴 致命 |
| ✅ 缺少错误日志 | `job_handler.py` | 异常时无 traceback 输出，难以调试 | 🟡 重要 |

#### 修复内容

1. **`wan_local.py`**：删除 `"--sample_nums", "1"` 行
2. **`requirements.txt`**：添加 `easydict imageio imageio-ffmpeg ftfy diffusers transformers tokenizers accelerate tqdm opencv-python-headless`
3. **`job_handler.py`**：`encoding="utf-8"` → `"utf-8-sig"`，添加 `logger.error(...traceback...)` 
4. **测试项目**：创建 `projects/test-video-001/`（含 storyboard.json + audio_durations.json）

#### 测试流程

```bash
# Step 1: 重建容器（含新依赖）
cd D:\work\novel-workflow
docker compose build --no-cache video-service
docker compose up -d video-service

# Step 2: 提交视频生成任务
curl -s -X POST http://localhost:8004/jobs \
  -H "Content-Type: application/json" \
  -d '{"project_id":"test-video-001","config":{"width":832,"height":480,"num_frames":65,"num_inference_steps":20}}'

# Step 3: 跟踪进度（Wan 每段约 5 分钟）
curl -s http://localhost:8004/jobs/{job_id}/status

# 成功标志：
# - status=completed
# - projects/test-video-001/clips/shot-001.mp4 存在且大小 > 0
```

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
