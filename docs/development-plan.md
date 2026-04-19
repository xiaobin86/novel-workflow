# Novel Workflow v1.0 — 开发执行计划

> **版本**：v1.0  
> **创建时间**：2026-04-18  
> **目标**：完成从设计文档到可运行代码的完整实现  
> **预计总工时**：约 60-70 小时  
> **最后更新**：{last_updated}

---

## 1. 项目概况

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
| WebUI 设计 | `docs/technical/design/07-webui-design.md` | 完整（750行）|
| 技术架构 | `docs/technical/architecture/001-tech-stack.md` | 完整 |
| 调研报告 | `docs/research/ui-design/` & `docs/research/ai-services/` | 完整 |

### ❌ 待实现（代码层面）

- `services/` 目录 — 5个 FastAPI 服务代码
- `apps/web/` 目录 — Next.js 前端代码
- `infra/docker-compose.yml` — Docker 编排（当前只有 PostgreSQL 模板）
- `.env.example` — 环境变量模板

---

## 3. 开发阶段与任务分解

### Phase 1: 项目骨架与通用模块（~7小时）

**目标**：搭建统一的目录结构、实现所有服务共用的基础模块

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **1.1** | 创建目录结构 | 建立 `services/`、`apps/web/`、`infra/` 等标准目录 | 1h | - | 完整的目录骨架 |
| **1.2** | 实现 `shared/job_manager.py` | 通用 Job 生命周期管理（所有5个服务共用同一套逻辑） | 3h | 1.1 | 可复用的 JobManager 类 |
| **1.3** | 实现 `shared/model_manager.py` | GPU 服务模型加载/卸载管理 + video-service 专用进程锁版本 | 2h | 1.1 | ModelManager 类 + VideoModelManager 子类 |
| **1.4** | 创建 `.env.example` | 所有环境变量统一模板（服务端口、模型路径、API Keys） | 1h | - | 完整的环境变量文档 |

**设计参考**：`docs/technical/design/01-services-overview.md` 第2节（JobManager）、第3节（ModelManager）

**QA 验证**：
- [ ] `services/` 目录结构符合设计规范
- [ ] JobManager 能创建/取消/查询 Job，SSE 事件流正常
- [ ] ModelManager 能按需加载/卸载模型，TTL 自动卸载工作
- [ ] `.env.example` 包含所有必要变量

---

### Phase 2: 后端服务开发（~27小时）

**目标**：实现5个 FastAPI 微服务，每个服务独立运行、独立测试

#### 2.1 storyboard-service（~4小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **2.1.1** | 创建服务骨架 | `main.py` + `requirements.txt` + `Dockerfile` | 1h | 1.1-1.2 | 可运行的 FastAPI 服务 |
| **2.1.2** | 实现 KimiProvider | 调用 Kimi API 生成 storyboard.json | 2h | 2.1.1 | 完整的 Provider 实现 |
| **2.1.3** | 集成 JobManager | POST /jobs + SSE events + 错误处理 | 1h | 2.1.2 | 端到端可测试 |

**设计参考**：`docs/technical/design/02-service-storyboard.md`  
**MVP参考**：`D:/work/novel-comic-drama-2/storyboard_generator.py`

**QA 验证**：
- [ ] POST /jobs 返回 job_id，状态为 queued
- [ ] SSE 推送 progress/complete 事件
- [ ] 生成的 storyboard.json 符合数据模型规范
- [ ] 错误时推送 error 事件（retryable=true）

---

#### 2.2 tts-service（~4小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **2.2.1** | 创建服务骨架 | `main.py` + `requirements.txt` + `Dockerfile` | 1h | 1.1-1.2 | 可运行的 FastAPI 服务 |
| **2.2.2** | 实现 EdgeTTSProvider | edge-tts 调用 + 旁白/对话双轨生成 | 2h | 2.2.1 | 完整的 Provider 实现 |
| **2.2.3** | 集成 JobManager | 按 shot 逐个生成，断点续传 | 1h | 2.2.2 | 端到端可测试 |

**设计参考**：`docs/technical/design/04-service-tts.md`  
**MVP参考**：`D:/work/novel-comic-drama-2/generate_audio.py`

**QA 验证**：
- [ ] 生成 WAV 文件（旁白 + 对话）
- [ ] 生成 `audio_durations.json` 供 video-service 使用
- [ ] 断点续传：已存在的文件自动跳过
- [ ] SSE 推送每个轨道的进度

---

#### 2.3 image-service（~6小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **2.3.1** | 创建服务骨架 | `main.py` + `requirements.txt` + `Dockerfile`（GPU镜像） | 1h | 1.1-1.3 | 可运行的 FastAPI 服务 |
| **2.3.2** | 实现 FluxLocalProvider | FLUX 4-bit 量化加载 + 单张图片生成 | 3h | 2.3.1 | 完整的 Provider 实现 |
| **2.3.3** | 集成 ModelManager | 按需加载、TTL 自动卸载、强制卸载 | 1h | 2.3.2 | GPU 资源管理正常 |
| **2.3.4** | 集成 JobManager | 按 shot 逐个生成，断点续传 | 1h | 2.3.3 | 端到端可测试 |

**设计参考**：`docs/technical/design/03-service-image.md`  
**MVP参考**：`D:/work/novel-comic-drama-2/batch_generate_flux.py`

**QA 验证**：
- [ ] 模型首次加载成功（约2分钟）
- [ ] 生成 768×768 PNG 图片
- [ ] 断点续传：已存在的文件自动跳过
- [ ] `/model/unload` 释放 GPU 显存
- [ ] 10 shots 总时间约 15-20 分钟

---

#### 2.4 video-service（~8小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **2.4.1** | 创建服务骨架 | `main.py` + `requirements.txt` + `Dockerfile`（GPU镜像） | 1h | 1.1-1.3 | 可运行的 FastAPI 服务 |
| **2.4.2** | 实现 WanSubprocessProvider | subprocess 调用 Wan2.1/generate.py | 4h | 2.4.1 | 完整的 Provider 实现 |
| **2.4.3** | 集成 VideoModelManager | 进程锁 + 超时保护 + 强制 kill | 2h | 2.4.2 | Subprocess 稳定运行 |
| **2.4.4** | 集成 JobManager | 时长自适应 + FFmpeg 冻结帧补齐 | 1h | 2.4.3 | 端到端可测试 |

**设计参考**：`docs/technical/design/05-service-video.md`  
**MVP参考**：`D:/work/novel-comic-drama-2/batch_generate_wan.py`

**⚠️ 特别注意**：
- 使用 subprocess 方式，不是直接 import Wan
- 必须实现 `_generate_lock` 信号量防止并发
- 超时保护：600秒，超时强制 kill 进程
- 临时文件 + 原子写入

**QA 验证**：
- [ ] subprocess 成功调用 Wan2.1/generate.py
- [ ] 生成 832×480 MP4 视频片段
- [ ] TTS 时长超过默认4秒时，自动冻结帧补齐
- [ ] 断点续传：已存在的文件自动跳过
- [ ] 超时机制工作正常（超时后进程被 kill）
- [ ] 10 shots 总时间约 50-55 分钟

---

#### 2.5 assembly-service（~5小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **2.5.1** | 创建服务骨架 | `main.py` + `requirements.txt` + `Dockerfile` | 1h | 1.1-1.2 | 可运行的 FastAPI 服务 |
| **2.5.2** | 实现 FFmpeg 编排 | 素材验证 → 时长对齐 → concat → 混音 → 合并 | 3h | 2.5.1 | assembler.py 核心逻辑 |
| **2.5.3** | 实现 SRT 生成 | 根据 shot 时间轴生成字幕文件 | 0.5h | 2.5.2 | srt_generator.py |
| **2.5.4** | 集成 JobManager | 分阶段进度推送 | 0.5h | 2.5.3 | 端到端可测试 |

**设计参考**：`docs/technical/design/06-service-assembly.md`  
**MVP参考**：`D:/work/novel-comic-drama-2/video_assembler.py`

**QA 验证**：
- [ ] 素材缺失时返回明确错误
- [ ] concat demuxer 拼接视频（不使用 xfade）
- [ ] amix 混合旁白 + 对话音频
- [ ] 输出 `final.mp4` + `final.srt`
- [ ] 输出格式为 yuv420p（兼容播放器）
- [ ] 10 shots 总时间约 1-3 分钟

---

### Phase 3: 前端开发（~22小时）

**目标**：实现 Next.js 15 Web UI，包含项目管理 + Pipeline Wizard

#### 3.1 项目初始化（~2小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **3.1.1** | Next.js 初始化 | `npx shadcn@latest init` + 配置 | 1h | - | 可运行的 Next.js 项目 |
| **3.1.2** | 安装依赖 | shadcn 组件 + SWR + 其他库 | 0.5h | 3.1.1 | package.json 完整 |
| **3.1.3** | 全局配置 | Tailwind 主题 + layout.tsx + 字体 | 0.5h | 3.1.2 | 统一的 UI 基础 |

**设计参考**：`docs/technical/design/07-webui-design.md` 第1节（目录结构）、第10节（技术栈）

**QA 验证**：
- [ ] `npm run dev` 启动成功，端口3000
- [ ] shadcn 组件可正常使用
- [ ] 全局样式（主题色、字体）一致

---

#### 3.2 API Routes（~6小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **3.2.1** | 项目管理 API | GET/POST/PATCH/DELETE /api/projects | 2h | 3.1 | 项目 CRUD |
| **3.2.2** | Pipeline 编排 API | POST /api/pipeline/[id]/[step]/start | 2h | 3.2.1 | 服务调用 + state 更新 |
| **3.2.3** | SSE 代理 API | GET /api/pipeline/[id]/[step]/events | 1.5h | 3.2.2 | 透传服务 SSE 流 |
| **3.2.4** | 文件访问 API | GET /api/projects/[id]/files/[...path] | 0.5h | 3.2.1 | 静态资源代理 |

**设计参考**：`docs/technical/design/07-webui-design.md` 第3节（API Routes 设计）

**QA 验证**：
- [ ] 创建项目后生成 `projects/{id}/state.json`
- [ ] POST pipeline/start 返回 job_id，更新 state
- [ ] SSE 代理实时推送进度到浏览器
- [ ] 文件 API 可访问图片/音频/视频

---

#### 3.3 页面与组件（~14小时）

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **3.3.1** | 项目列表页 | `/projects` — ProjectCard + NewProjectDialog | 3h | 3.1 | 完整的项目列表界面 |
| **3.3.2** | Pipeline Wizard | 5步骤向导容器 + StepCard 通用组件 | 4h | 3.1 | 向导框架 |
| **3.3.3** | StoryboardStep | 分镜预览 + 文本输入 | 1.5h | 3.3.2 | 步骤1内容 |
| **3.3.4** | ImageStep | 图片网格 + 进度 | 2h | 3.3.2 | 步骤2内容 |
| **3.3.5** | TTSStep | 音频列表 + 播放器 | 1.5h | 3.3.2 | 步骤3内容 |
| **3.3.6** | VideoStep | 视频片段网格 + 播放器 | 1.5h | 3.3.2 | 步骤4内容 |
| **3.3.7** | AssemblyStep | 最终视频播放器 + 下载 | 1.5h | 3.3.2 | 步骤5内容 |
| **3.3.8** | AutoModeToggle | 自动模式开关 + 状态管理 | 1h | 3.3.2 | 全局自动模式 |

**设计参考**：`docs/technical/design/07-webui-design.md` 第2节（页面设计）、第4节（组件设计）

**QA 验证**：
- [ ] 项目列表页显示所有项目及进度
- [ ] Pipeline Wizard 正确显示5个步骤状态
- [ ] 每个步骤显示对应的内容/进度/预览
- [ ] 自动模式开关工作正常
- [ ] 步骤间导航正确（前序未完成时不可进入）

---

### Phase 4: 集成与部署（~10小时）⚠️ **此阶段需经用户审核后再启动**

**目标**：Docker 编排 + 端到端集成测试  
**状态**：Phase 1-3 完成并经用户确认后，方可进入此阶段

| 任务ID | 任务 | 说明 | 预估工时 | 依赖 | 交付物 |
|--------|------|------|----------|------|--------|
| **4.1** | Docker Compose 编排 | 5服务 + Next.js + 模型挂载 + GPU | 4h | Phase 2-3 + 用户确认 | `infra/docker-compose.yml` |
| **4.2** | 服务健康检查 | 各服务 Dockerfile + healthcheck 配置 | 2h | 4.1 | 容器健康检查正常 |
| **4.3** | Mock 集成测试 | 使用 mock 数据验证 Pipeline 流程（不依赖真实 GPU） | 2h | 4.2 | 流程跑通，记录问题 |
| **4.4** | 用户审核 | 展示 mock 测试结果，等待用户确认 | - | 4.3 | 用户批准继续 |
| **4.5** | 真实 GPU 集成测试 | 完整 Pipeline 跑通（使用测试文本） | 3h | 4.4 | 最终视频生成成功 |
| **4.6** | 进程守护验证 | 异常恢复、优雅关闭测试 | 1h | 4.5 | 崩溃后可自动恢复 |

**审核检查点**：
- Phase 1-3 完成后，必须向用户汇报进展
- Mock 集成测试（4.3）完成后，必须展示结果并等待用户确认
- 用户确认后，方可进行真实 GPU 测试（4.5）

**设计参考**：`docs/technical/design/01-services-overview.md` 第5节（启动顺序）、第7节（进程守护）

**QA 验证**：
- [ ] `docker compose up` 启动所有服务
- [ ] Next.js 可访问所有服务健康检查
- [ ] 完整 Pipeline 从小说文本到最终视频跑通
- [ ] 中途停止后可从断点继续
- [ ] 服务崩溃后 Docker 自动重启

---

## 4. 并行执行策略

### 可并行任务

```
Phase 1: [1.1] → [1.2 + 1.3 + 1.4]
         │
         ├─→ Phase 2.1: [2.1.1 → 2.1.2 → 2.1.3]  (storyboard)
         ├─→ Phase 2.2: [2.2.1 → 2.2.2 → 2.2.3]  (tts)
         ├─→ Phase 2.3: [2.3.1 → 2.3.2 → 2.3.3 → 2.3.4]  (image)
         ├─→ Phase 2.4: [2.4.1 → 2.4.2 → 2.4.3 → 2.4.4]  (video)
         ├─→ Phase 2.5: [2.5.1 → 2.5.2 → 2.5.3 → 2.5.4]  (assembly)
         │
         └─→ Phase 3.1: [3.1.1 → 3.1.2 → 3.1.3]  (Next.js init)
              │
              └─→ Phase 3.2: [3.2.1 → 3.2.2 → 3.2.3 → 3.2.4]
                   │
                   └─→ Phase 3.3: [3.3.1 → 3.3.2 → 3.3.3-8]
                        │
                        └─→ Phase 4: [4.1 → 4.2 → 4.3 → 4.4]
```

### 最大并行度

- **Phase 1 完成后**：可同时启动 2.1、2.2、2.3、2.5 和 3.1（5条并行线）
- **2.3 完成后**：可启动 2.4（video 依赖 image 的 GPU 释放，但代码可并行写）
- **Phase 2 完成后**：启动 Phase 3.2-3.3
- **Phase 2+3 完成后**：启动 Phase 4

**建议**：每个 Phase 完成后做一次集成验证，不要等全部完成再集成。

### Mock 开发策略

在真实 GPU/模型环境就绪前，所有服务应支持 **Mock 模式**，以便并行开发和前端联调：

| 服务 | Mock 方式 | Mock 输出 |
|------|----------|----------|
| storyboard-service | 返回预定义的 storyboard.json | `fixtures/mock_storyboard.json` |
| image-service | 复制预置的 PNG 图片 | `fixtures/mock_images/*.png` |
| tts-service | 复制预置的 WAV 音频 | `fixtures/mock_audio/*.wav` |
| video-service | 复制预置的 MP4 视频 | `fixtures/mock_clips/*.mp4` |
| assembly-service | 复制预置的 final.mp4 | `fixtures/mock_output/final.mp4` |

**Mock 切换方式**：通过环境变量 `MOCK_MODE=true` 控制，Mock Provider 在 `providers/mock.py` 中实现。

**好处**：
- 前端开发无需等待后端服务完成
- 集成测试可在无 GPU 环境下验证流程
- 快速迭代 UI 和流程逻辑

---

## 5. Handoff 机制

### 每个任务完成后的 Handoff 要求

**必须更新 `HANDOFF.md`**，包含以下信息：

1. **已完成的工作**：任务ID、完成时间、关键变更
2. **新增/修改的文件**：文件路径列表
3. **已知问题**：遇到的坑、未解决的 TODO
4. **测试验证结果**：通过的 QA 检查项
5. **下一步建议**：接下来应该做什么

### Handoff 更新位置

在 `HANDOFF.md` 的"当前状态"章节更新，格式：

```markdown
## 当前状态（实时更新）

### ✅ 已完成
- [2.1.1] storyboard-service 骨架 — 2026-04-18 — Sisyphus
- [2.1.2] KimiProvider 实现 — 2026-04-18 — Sisyphus
- ...

### 🚧 进行中
- [2.3.2] FluxLocalProvider 实现 — CodeAgent-A

### ⏳ 待开始
- [2.4] video-service — 等待 2.3 完成
- ...
```

---

## 6. 风险管理

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **GPU 环境不稳定** | CUDA OOM、驱动错误导致服务崩溃 | 进程守护（自动重启）、单 shot 失败不中断 Job |
| **模型加载时间长** | 首次请求等待 2 分钟 | 前端显示"模型加载中"进度、支持断点续传 |
| **Wan subprocess 不稳定** | 进程假死、僵尸进程 | 超时保护（600s）、强制 kill、临时文件原子写入 |
| **并发冲突** | image/video 同时运行导致 OOM | 编排器强制串行、ModelManager 锁机制 |
| **文件系统权限** | Docker 内无法读写 projects/ 目录 | 正确配置 volume 挂载、权限设置 |
| **SSE 连接断开** | 浏览器刷新后丢失进度 | SWR 轮询（5s）作为 fallback |

---

## 7. 技术决策清单

| 决策 | 选择 | 理由 |
|------|------|------|
| Python 版本 | 3.11 | FastAPI 兼容性 + Docker 镜像体积 |
| GPU 基础镜像 | `pytorch/pytorch:2.7.0-cuda12.8-cudnn9-devel` | 支持 Blackwell (sm_120) |
| CPU 基础镜像 | `python:3.11-slim` | 体积小，启动快 |
| FLUX 量化 | 4-bit NF4 (BitsAndBytes) | 23GB → ~6GB VRAM |
| Wan 调用方式 | Subprocess (generate.py) | 避免 Docker 内 import 路径问题 |
| 前端状态管理 | SWR + React State | 简单够用，无需 Redux/Zustand |
| 进度推送 | SSE (Server-Sent Events) | 单向流，实现简单 |
| 文件存储 | 本地文件系统 | 单用户场景，无需对象存储 |

---

## 8. 附录

### A. MVP 参考代码位置

```
D:/work/novel-comic-drama-2/
├── storyboard_generator.py      → 2.1 storyboard-service
├── batch_generate_flux.py       → 2.3 image-service
├── generate_audio.py            → 2.2 tts-service
├── batch_generate_wan.py        → 2.4 video-service
└── video_assembler.py           → 2.5 assembly-service
```

### B. 模型文件位置

```
D:\work\novel-comic-drama\models\
├── FLUX.1-dev/                  → image-service 挂载到 /app/models/FLUX.1-dev/
└── Wan2.1-T2V-1.3B/             → video-service 挂载到 /app/models/Wan2.1-T2V-1.3B/
```

### C. 关键约束速查

- GPU 串行：image 和 video 不能同时运行
- 视频时长：`max(声明时长, TTS时长 + 0.5s)`
- FFmpeg：必须使用 concat demuxer，不能用 xfade
- 输出格式：必须加 `-pix_fmt yuv420p`
- edge-tts：输出是 MP3 格式（扩展名.wav但内容是mp3），FFmpeg 可直接处理

### D. 环境信息

| 项目 | 值 |
|------|-----|
| GPU | NVIDIA RTX 5070 Ti Laptop (12GB VRAM) |
| GPU 架构 | Blackwell (sm_120) |
| OS | Windows 11 |
| Python | 3.12 |
| PyTorch | 2.7.0+cu128 |

---

## 9. 用户确认记录

### 2026-04-18 用户确认（通过对话）

**确认内容**：
1. ✅ **按上述顺序开发**：Phase 1 → Phase 2 → Phase 3 → Phase 4（审核点）
2. ✅ **并行开发**：使用子 Agent 并行执行独立任务
3. ✅ **到集成部署时停下**：Phase 4 需经用户审核后再启动
4. ✅ **先 Mock 后真实**：Mock 集成测试（4.3）完成后，向用户展示结果并等待确认，确认后方可进行真实 GPU 测试（4.5）
5. ✅ **交接给另一 Agent**：当前 Agent（Sisyphus）完成规划后暂停，由另一 Agent 开始执行 Phase 1-3

**补充要求**：
- 每个任务完成后更新 HANDOFF.md
- 另一 Agent 工作完成后需提供交接文档
- Phase 1-3 完成后必须向用户汇报进展

---

*本文档由 Sisyphus Agent 创建*  
*最后更新：2026-04-18*
