# Handoff Document — Novel Workflow v1.0

> **生成时间**：2026-04-18  
> **生成者**：Sisyphus Agent  
> **状态**：文档阶段完成，等待 Code Agent 接手编码  
> **目标读者**：另一位 Claude Code Agent（编码执行者）

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

| 模块 | 状态 | 说明 |
|------|------|------|
| PRD | ✅ 完整 | `docs/product/prd/v1.0-core-mvp.md` — 功能范围明确 |
| 数据模型 | ✅ 完整 | `docs/technical/design/00-data-model.md` — Shot/Storyboard/ProjectState/API契约 |
| 服务层设计 | ✅ 完整 | `01-services-overview.md` — 通用规范、JobManager、ModelManager、Provider、进程守护 |
| storyboard-service | ✅ 完整 | `02-service-storyboard.md` — Kimi API → 分镜 JSON |
| image-service | ✅ 完整 | `03-service-image.md` — FLUX.1-dev → PNG |
| tts-service | ✅ 完整 | `04-service-tts.md` — edge-tts → WAV |
| video-service | ✅ 完整 | `05-service-video.md` — Wan2.1 → MP4（含 subprocess 方式说明） |
| assembly-service | ✅ 完整 | `06-service-assembly.md` — FFmpeg → final.mp4 + SRT |
| WebUI 设计 | ✅ 完整 | `07-webui-design.md` — 750行，页面/API/组件/状态管理 |
| 技术架构 | ✅ 完整 | `001-tech-stack.md` — 技术选型、端口设计 |
| 进程守护 | ✅ 已补充 | `01-services-overview.md` 第7节 — Docker/Python/业务/健康检查多层保障 |

### ⚠️ 标记为"待补充"的文档

以下文档已标记为"待补充"，**编码阶段暂不依赖**：

- `docs/technical/design/api-gateway.md` — v1.0 无需独立网关
- `docs/technical/design/data-model.md` — 与 `00-data-model.md` 重复
- `docs/technical/architecture/002-auth-strategy.md` — v1.0 无需认证
- `docs/qa/*` — 测试计划待开发阶段补充
- `docs/runbooks/*` — 运维手册待部署阶段补充
- `docs/technical/api/*` — API 文档已分散在各服务设计中
- `docs/product/features/user-auth.md` — v1.0 无此功能

### ❌ 完全缺失（编码阶段需创建）

| 文件 | 说明 |
|------|------|
| `services/` 目录 | 5个 FastAPI 服务代码 |
| `apps/web/` 目录 | Next.js 前端代码 |
| `infra/docker-compose.yml` | 当前只有 PostgreSQL 模板，需重写 |
| `.env.example` | 环境变量模板（当前只有空文件） |

---

## 3. 关键设计决策（编码前必读）

### 3.1 数据模型（唯一权威来源：`00-data-model.md`）

**Shot 结构**：
```json
{
  "shot_id": "E01_001",
  "duration": 4.0,
  "shot_type": "medium",           // 枚举: wide/medium/close_up/extreme_close_up/over_shoulder
  "camera_move": "static",         // 枚举: static/pan/zoom_in/zoom_out/dolly/tracking
  "scene": "...",
  "characters": ["萧炎"],
  "emotion": "determined",
  "action": "旁白文本（中文）",
  "dialogue": null,                // 有台词时为字符串，无则为 null
  "image_prompt": "英文提示词（FLUX）",
  "video_prompt": "英文提示词（Wan）"
}
```

**Storyboard 结构**：
```json
{
  "project": { "title": "...", "episode": "...", "total_shots": 10, "total_duration": 40, "source_novel": "..." },
  "characters": [ { "id": "...", "name": "...", "gender": "...", "appearance": "..." } ],
  "shots": [ /* Shot[] */ ],
  "created_at": "..."
}
```

> ⚠️ **注意**：MVP 代码 `novel-comic-drama-2/storyboard_generator.py` 生成的 JSON 使用旧枚举值（`close-up`/`tracking`），**编码时需修改为新的枚举值**（`close_up`/`tracking`）。

### 3.2 端口与网络设计

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

### 3.3 GPU 串行约束

```
image-service 和 video-service 不能同时运行（共享 12GB VRAM）
编排顺序:
  storyboard → (image + tts 并行) → video → assembly

切换 GPU 服务前必须调用 POST /model/unload:
  image 完成后 → POST image-service/model/unload
  video 完成后 → POST video-service/model/unload
```

### 3.4 Video-Service 采用 Subprocess 方式

**关键决策**：video-service 不直接 import Wan 模型，而是通过 **subprocess 调用** `Wan2.1/generate.py`。

原因：
- Wan 原格式推理代码依赖复杂的环境配置，Docker 内直接 import 风险高
- 与 MVP 验证过的方案一致

影响：
- `model_manager.py` 简化为**进程锁管理器**（不是模型加载器）
- SSE 无法提供逐帧进度，采用**阶段式进度**（"启动中..." → "完成"）
- subprocess 超时保护 + 强制 kill 机制必须实现
- 详见 `05-service-video.md` 第 10 节

### 3.5 BGM 不在 v1.0 范围内

- `bgm_mood` 字段已从 Shot 模型移除
- assembly-service 中不处理 BGM 轨道
- 混音只包含：旁白轨 + 台词轨

### 3.6 进程守护策略

编码时必须在每个服务的 `main.py` 中实现：
1. **全局异常捕获 middleware** — 防止未处理异常终止进程
2. **SIGTERM 优雅关闭** — Docker stop 时清理资源（卸载模型、取消 Job、kill subprocess）
3. **健康检查** — `/health` 只验证 FastAPI 进程正常（不等待模型加载）
4. **Docker restart policy** — `unless-stopped`
5. **资源限制** — memory limit + shm_size

详见 `01-services-overview.md` 第 7 节。

---

## 4. MVP 参考代码位置

**不要照抄**，但可参考实现逻辑：

| 服务 | 参考文件 | 说明 |
|------|----------|------|
| storyboard | `D:/work/novel-comic-drama-2/storyboard_generator.py` | Kimi API 调用逻辑、Prompt 模板 |
| image | `D:/work/novel-comic-drama-2/batch_generate_flux.py` | FLUX 加载、4-bit 量化、CPU offload |
| tts | `D:/work/novel-comic-drama-2/generate_audio.py` | edge-tts 调用、双层音轨 |
| video | `D:/work/novel-comic-drama-2/batch_generate_wan.py` | Wan subprocess 调用方式 |
| assembly | `D:/work/novel-comic-drama-2/video_assembler.py` | FFmpeg 拼接、混音、SRT 生成 |

**模型文件位置**：`D:\work\novel-comic-drama\models`
- 需要挂载到 Docker 容器内 `/app/models/`
- 用户会自行配置 Docker 挂载

---

## 5. 编码任务优先级建议

### P0 — 必须先完成（阻塞后续工作）

1. **通用模块实现**
   - `services/shared/job_manager.py` — 所有服务共用
   - `services/shared/model_manager.py` — GPU 服务使用

2. **docker-compose.yml**
   - 5个服务 + Next.js 的完整编排
   - 端口映射、模型挂载、GPU 访问、健康检查

### P1 — 核心服务

3. **storyboard-service** — 最简单，无 GPU，可先验证 Job 模式
4. **image-service** — 需要 GPU，验证 ModelManager
5. **tts-service** — 纯 CPU，可与 image 并行验证
6. **video-service** — 最复杂，subprocess 方式
7. **assembly-service** — FFmpeg 编排

### P2 — Web UI

8. **Next.js 项目骨架** — 安装依赖、配置 Tailwind + shadcn/ui
9. **API Routes** — 项目管理 + Pipeline 编排
10. **前端页面** — 项目列表 + Pipeline Wizard

### P3 —  polish

11. **E2E 测试** — Playwright
12. **空文档补充** — 测试计划、部署手册等

---

## 6. 已知陷阱与注意事项

### ❌ 不要做的事

| 陷阱 | 后果 | 正确做法 |
|------|------|----------|
| image/video 同时运行 | CUDA OOM，容器崩溃 | 严格串行，编排器控制 |
| video-service 直接 import Wan | Docker 内 import 路径问题 | 使用 subprocess 方式 |
| 忽略 subprocess 超时 | 服务假死，无法处理新请求 | 必须实现 timeout + kill |
| health check 等待模型加载 | 容器启动时间极长，被 Docker 判定 unhealthy | `/health` 只检查 FastAPI 进程 |
| 使用 xfade 拼接视频 | 多片段时丢内容 | 使用 concat demuxer |
| 视频固定 4 秒 | TTS 被截断 | 自适应延长：max(声明时长, TTS时长+0.5s) |
| 忽略 Windows 路径反斜杠 | FFmpeg 解析错误 | 使用 `as_posix()` + `replace(':','\\:')` |

### ⚠️ 需要特别注意

1. **PyTorch 版本**：必须使用 `2.7.0+cu128`，唯一支持 Blackwell (sm_120) 的版本
2. **Wan 格式**：必须使用**原格式**（16.6GB），不是 diffusers 格式（27GB，32GB RAM 无法加载）
3. **FFmpeg 格式**：输出必须加 `-pix_fmt yuv420p`，否则部分播放器不兼容
4. **edge-tts 输出**：扩展名 `.wav` 但实际是 MP3 格式，FFmpeg 可直接处理
5. **断点续传**：每个 shot 处理前检查目标文件是否存在且大小 > 0

---

## 7. 与 Sisyphus Agent 的协作方式

### 7.1 沟通渠道

**唯一沟通方式**：通过 Handoff 文档 + Git commit message。

> ⚠️ **我们没有实时沟通渠道**。所有信息必须通过文档或代码注释传递。

### 7.2 交接规则

| 场景 | 操作 |
|------|------|
| **完成一个模块** | 更新本 Handoff 文档的"当前状态"章节，标记为 ✅ |
| **发现文档问题** | 修改对应文档，在 Handoff 中记录变更 |
| **设计决策变更** | 修改对应设计文档 + 更新 Handoff "关键决策"章节 |
| **遇到阻塞问题** | 在 Handoff 末尾添加"待讨论问题"列表 |
| **完成全部编码** | 更新 Handoff 状态为"编码完成"，列出已验证/未验证项 |

### 7.3 Handoff 文档位置

```
D:\work\novel-workflow\HANDOFF.md   ← 本文件
```

**更新方式**：直接编辑此文件，Git commit 时说明更新内容。

### 7.4 信息完整性检查清单

在交接时，确保以下信息已传递：

- [ ] 已完成的工作列表
- [ ] 已修改的设计文档列表
- [ ] 新发现的问题或陷阱
- [ ] 测试验证结果（如有）
- [ ] 依赖项变更（新增的包、工具等）

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

## 9. 待讨论问题（编码阶段可能遇到）

> 此列表由编码 Agent 动态更新

| # | 问题 | 状态 | 备注 |
|---|------|------|------|
| 1 | Docker 在 Windows 上的 GPU 支持（WSL2 vs Hyper-V）| 待验证 | 用户需确认 Docker Desktop 配置 |
| 2 | Wan subprocess 在 Docker 内的 Python 环境路径 | 待验证 | 需测试 `Wan2.1/generate.py` 能否在容器内运行 |
| 3 | Next.js 在 Docker 内访问宿主机 `projects/` 目录 | 待验证 | 需测试 volume 挂载 |
| 4 | FLUX 4-bit 量化在 Docker 内的兼容性 | 待验证 | 依赖 bitsandbytes + CUDA 12.8 |

---

*本文档由 Sisyphus Agent 创建*  
*最后更新：2026-04-18*  
*下一步：等待 Code Agent 确认接收，开始编码阶段*
