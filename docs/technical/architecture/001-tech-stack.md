# ADR-001: Tech Stack Selection

## Status
Accepted

## Context
小说漫剧生成平台是一个 AI 驱动的多步骤内容生产工具，需要协调多个本地 GPU 模型和外部 API。
用户为个人使用（单用户），核心需求是流程可视化、分步执行和进度追踪。

## Decision

### 前端
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **进度推送**: Server-Sent Events (SSE)

### AI 服务层（Docker 微服务）
每个流程步骤作为独立 Docker 容器，通过 HTTP 与 Next.js 通信：

| 服务 | 端口 | 技术 | 职责 |
|------|------|------|------|
| storyboard-service | 8001 | FastAPI + Python | 小说 → 分镜 JSON（Kimi API） |
| image-service | 8002 | FastAPI + Python | 分镜 → 图片（FLUX.1-dev，本地 GPU） |
| video-service | 8003 | FastAPI + Python | 分镜 → 视频片段（Wan2.1，本地 GPU）+ TTS（edge-tts） |
| assembly-service | 8004 | FastAPI + Python | 素材 → 最终 MP4（FFmpeg） |

### AI Provider 模式
每个服务内部使用 Provider 抽象层，统一标准输入输出接口，支持未来从本地 GPU 切换至云端（Replicate、fal.ai 等）而不改动上层逻辑。

### 任务队列
Next.js API Routes 串行调度各服务，SSE 推送进度至浏览器。无需独立队列服务（单用户场景）。

### 存储
- 项目文件：本地文件系统 `projects/{project_id}/`
- 项目元数据：JSON 文件（`projects/{project_id}/state.json`）

### 基础设施
- Docker Compose 编排所有服务
- GPU 服务通过 `nvidia-container-toolkit` 访问本地显卡

## Consequences
- GPU（12GB VRAM）资源有限，image-service 和 video-service 必须串行执行，不可并行
- 单用户场景下无需认证、无需数据库
- Provider 抽象层使云端扩展成本低，仅需新增 provider 实现
- 全流程约 70 分钟，SSE 实时进度对用户体验至关重要
