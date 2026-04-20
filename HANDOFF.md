# Handoff Document — Novel Workflow v1.0

> **生成时间**：2026-04-20  
> **生成者**：Sisyphus Agent  
> **目标读者**：接手的 Agent（Claude / OPENCODE / 其他）  
> **工作目录**：`D:\work\novel-workflow`  
> **分支**：`develop`

---

## ⚠️ 必读：文档与代码不一致清单（共 10 项）

**以下设计文档中的描述与当前代码实现不一致，接手时请以代码为准，文档仅供参考。**

| # | 文档 | 不一致内容 | 代码真实状态 | 影响 |
|---|------|-----------|-------------|------|
| 1 | `07-webui-design.md` 目录结构 | 列出 `components/project/`、`components/pipeline/`、`components/viewer/` 子目录 | **所有组件都在 `components/` 根目录**，无子目录 | 低 — 只是目录扁平化 |
| 2 | `07-webui-design.md` / `08-step-lifecycle-control.md` | 说 `useStepControl` 有 `pauseStep`/`resumeStep`/`stopStep` | **只有 `stopStep`**，pause/resume **未实现**（相关 API 路由已删除） | 中 — 功能范围缩小 |
| 3 | `07-webui-design.md` | `useAutoMode` 为独立 hook 文件 | **内联函数**在 `page.tsx` 中（第 21-29 行） | 低 |
| 4 | `07-webui-design.md` / `08-step-lifecycle-control.md` | `StepCard` 为独立组件文件 | **内联组件**在 `page.tsx` 中（第 183 行起） | 低 |
| 5 | `00-data-model.md` / `08-step-lifecycle-control.md` | `steps[].result` 存储在 `state.json` 中 | **`result` 字段已从 state.json 中清除**，改为从磁盘独立读取（`recoverStepResult`） | **高** — 架构已变更 |
| 6 | `04-service-tts.md` / `00-data-model.md` | TTS 输出文件扩展名为 `.wav` | **实际输出 `.mp3`**（edge-tts 原生输出 mp3） | 中 — 文件路径需用 `.mp3` |
| 7 | `02-service-storyboard.md` | 使用 `openai` SDK + `response_format={"type": "json_object"}` | **使用原生 `httpx` 直接调用**，无 openai SDK | 低 — 实现方式不同，效果一致 |
| 8 | `01-services-overview.md` | 每个服务有独立的 `job_manager.py` / `model_manager.py` | **共享模块**在 `services/shared/` 下 | 低 |
| 9 | `07-webui-design.md` / 多处 | Next.js 15 + React 18 | **Next.js 16.2.4 + React 19.2.4** | 低 — 版本号差异 |
| 10 | `07-webui-design.md` | `.env.local` 中 `PROJECTS_BASE_DIR=/app/projects` | **实际为 `D:/work/novel-workflow/projects`**（本地开发模式） | 中 — 仅本地开发差异 |

---

## 一、项目概况

**Novel Workflow** 是一个单用户本地工具，将小说文本自动转化为**动漫风格短视频**（带配音+字幕）。

- **技术栈**：Next.js 16 + React 19 + 5个 FastAPI Docker 微服务
- **核心 Pipeline**：分镜生成 → 图片生成 → TTS音频 → 视频片段 → 素材拼装
- **硬件约束**：单张 RTX 5070 Ti 12GB，GPU 串行执行
- **目标**：v1.0 Core MVP，打通完整链路

---

## 二、当前代码状态（真实状态，截至 2026-04-20）

### 2.1 后端服务（5个 FastAPI 服务）

| 服务 | 端口 | 状态 | 说明 |
|------|------|------|------|
| storyboard-service | 8001 | ✅ 运行中 | KimiProvider（httpx 直接调用） |
| image-service | 8002 | ✅ 运行中 | FluxLocalProvider（4-bit NF4，GPU 已修复） |
| tts-service | 8003 | ✅ 运行中 | EdgeTTSProvider（输出 .mp3，非 .wav） |
| video-service | 8004 | ✅ 运行中 | WanSubprocessProvider（subprocess + Semaphore） |
| assembly-service | 8005 | ✅ 运行中 | FFmpeg 9步 pipeline |

**启动命令**：
```bash
cd D:\work\novel-workflow
docker compose up -d
```

### 2.2 前端（Next.js）

| 项目 | 状态 |
|------|------|
| 框架 | Next.js 16.2.4 + React 19.2.4 |
| 端口 | 3000 |
| 组件库 | shadcn/ui + Tailwind CSS |
| 状态管理 | SWR（轮询）+ React State |
| 实时进度 | SSE EventSource |

**启动命令**：
```bash
cd D:\work\novel-workflow\apps\web
npm install
npm run dev
```

### 2.3 已实现功能

- ✅ 项目 CRUD（创建、列表、删除、状态读取）
- ✅ Pipeline 5步骤执行（storyboard → image → tts → video → assembly）
- ✅ 实时 SSE 进度推送
- ✅ **停止功能**（stop）— 仅实现 stop，无 pause/resume
- ✅ **断点续传**（基于文件存在性检查）
- ✅ **状态验证与自动修正**（读取 state.json 时对比实际文件数）
- ✅ **步骤产物预览**（分镜列表/图片网格/音频播放器/视频播放器/最终视频）
- ✅ **重新生成**（步骤级重置 + 单个 shot 重新生成）
- ✅ 自动模式（完成一步自动执行下一步）
- ✅ GPU 串行控制（image 和 video 不并行）

### 2.4 未实现功能（文档中有设计，代码未完成）

| 功能 | 文档位置 | 状态 | 说明 |
|------|---------|------|------|
| **暂停 (pause)** | `08-step-lifecycle-control.md` | ❌ 未实现 | JobManager 有 `_stop_requested` 但无 `_pause_event` |
| **恢复 (resume)** | `08-step-lifecycle-control.md` | ❌ 未实现 | 同上 |
| **步骤直入（上传素材跳过）** | `07-webui-design.md` 第5章 | ❌ 未实现 | UI 无上传入口 |
| **单 shot 失败重试** | `07-webui-design.md` 第6.1节 | ❌ 未实现 | 只能整步重试 |
| **服务健康检查 UI** | `07-webui-design.md` 第6.3节 | ❌ 未实现 | 无 health check 展示 |
| **Mock 模式完整支持** | `01-services-overview.md` 第4.6节 | ⚠️ 部分 | 有 MockProvider 但未全面测试 |

---

## 三、关键代码文件清单（接手必看）

### 3.1 后端核心

| 文件 | 职责 |
|------|------|
| `services/shared/job_manager.py` | Job 生命周期 + SSE 广播 + 取消机制 |
| `services/shared/model_manager.py` | GPU 模型 TTL 按需加载/卸载 |
| `services/*/job_handler.py` | 各服务业务协程（含 `check_stop()` 检查点） |
| `services/*/main.py` | FastAPI 路由 |
| `services/*/providers/*.py` | Provider 实现 |

### 3.2 前端核心

| 文件 | 职责 |
|------|------|
| `apps/web/app/projects/[id]/page.tsx` | **项目详情页主文件**（含 StepCard、StepContent、StepArtifactsWrapper、useAutoMode 等所有内联组件） |
| `apps/web/app/projects/page.tsx` | 项目列表页 |
| `apps/web/components/step-artifacts.tsx` | 步骤产物预览（5个子组件） |
| `apps/web/hooks/useStepProgress.ts` | SSE 进度消费 |
| `apps/web/hooks/useStepControl.ts` | 步骤控制（**仅 stop**） |
| `apps/web/hooks/useProjectState.ts` | SWR 项目状态轮询 |
| `apps/web/lib/project-store.ts` | state.json 读写 + **状态验证逻辑** |
| `apps/web/lib/services.ts` | 服务地址映射 + StepName 类型 |

### 3.3 API Routes

| 路由 | 文件 | 说明 |
|------|------|------|
| `GET/POST /api/projects` | `app/api/projects/route.ts` | 项目列表/创建 |
| `GET/DELETE /api/projects/[id]` | `app/api/projects/[id]/route.ts` | 项目详情/删除 |
| `GET /api/projects/[id]/state` | `app/api/projects/[id]/state/route.ts` | 读取 state.json |
| `GET /api/projects/[id]/artifacts/[step]` | `app/api/projects/[id]/artifacts/[step]/route.ts` | 读取步骤产物 |
| `GET /api/projects/[id]/files/[...path]` | `app/api/projects/[id]/files/[...path]/route.ts` | 文件代理 |
| `POST /api/pipeline/[id]/[step]/start` | `app/api/pipeline/[id]/[step]/start/route.ts` | 启动步骤 |
| `POST /api/pipeline/[id]/[step]/stop` | `app/api/pipeline/[id]/[step]/stop/route.ts` | 停止步骤 |
| `POST /api/pipeline/[id]/[step]/reset` | `app/api/pipeline/[id]/[step]/reset/route.ts` | 重置步骤 |
| `POST /api/pipeline/[id]/[step]/regenerate-item` | `app/api/pipeline/[id]/[step]/regenerate-item/route.ts` | 重新生成单个 shot |
| `GET /api/pipeline/[id]/[step]/events` | `app/api/pipeline/[id]/[step]/events/route.ts` | SSE 代理 |

> ⚠️ **注意**：`pause/` 和 `resume/` API 路由 **不存在**（已被删除）。

---

## 四、关键设计决策（代码已实现的）

### 4.1 状态验证机制（新增）

读取 `state.json` 时，自动对比实际文件数量与 storyboard 分镜数：

```
image/tts/video 步骤：
  文件数 == 0          → 状态改为 "pending"
  文件数 >= 分镜数     → 状态改为 "completed"
  其他                 → 状态改为 "stopped"
```

**实现位置**：`apps/web/lib/project-store.ts` 中的 `validateStepStatuses()`

### 4.2 产物读取机制（变更）

- **旧方案**（文档描述）：产物列表从 `state.json` 中的 `steps[].result` 读取
- **新方案**（代码实现）：产物列表**直接从磁盘读取**，`state.json` 中的 `result` 字段已被清理
  - 好处：state.json 与文件系统不一致时，仍以文件系统为准
  - 实现：`recoverStepResult()` 扫描磁盘文件

### 4.3 停止机制

```
User 点击停止
  → Next.js 调用服务 POST /jobs/{job_id}/stop
  → JobManager: request_stop() + task.cancel()
  → Job Handler: check_stop() 抛出 CancelledError
  → 状态改为 CANCELLED，广播 stopped 事件
  → state.json 状态改为 "stopped"
```

**注意**：停止后已生成的文件保留，重新开始时自动跳过（断点续传）。

### 4.4 asyncio.Task 生命周期

```
1. JobManager.submit() 创建 JobRecord
2. asyncio.create_task(_run()) 启动后台 Task
3. _run() 调用业务协程 run_generate_*_job()
4. 业务协程循环中：check_stop() → 生成 → emit_progress()
5. 完成：emit_complete() / 取消：CancelledError → emit stopped
```

---

## 五、已知问题与陷阱

| 问题 | 影响 | 临时方案 | 根本修复建议 |
|------|------|---------|-------------|
| React 19 `use()` API 与 `Array.map` 冲突 | 页面报错 "Expected static flag was missing" | 已改为 `useParams()` | 等待 React 19 补丁 |
| TTS 输出格式不一致 | 文档说 `.wav`，实际 `.mp3` | 代码已用 `.mp3` | 统一文档 |
| pause/resume 功能缺失 | 用户无法暂停任务 | 只能用 stop（停止后可重新启动） | 实现 `_pause_event` + pause/resume 路由 |
| state.json 与磁盘不一致 | 重启后状态显示错误 | 已加 `validateStepStatuses()` 自动修正 | 无 — 已解决 |
| Docker Desktop 内存限制 | video-service OOM | 需手动调整内存至 24GB | 用户手动调整 |

---

## 六、文档规范要求（补充）

### 6.1 文档维护原则

1. **代码优先**：当文档与代码冲突时，以代码为准，文档需后续同步更新
2. **版本标注**：每份设计文档顶部应标注 `最后同步代码版本：commit hash`
3. **变更记录**：文档末尾必须有"变更记录"表格（日期/版本/变更内容/作者）

### 6.2 必须更新的文档清单

| 文档 | 需更新内容 | 优先级 |
|------|-----------|--------|
| `docs/technical/design/07-webui-design.md` | 目录结构（扁平化）、组件位置（内联）、pause/resume 未实现 | 高 |
| `docs/technical/design/08-step-lifecycle-control.md` | 标注 pause/resume 未实现、result 不再存储在 state.json | 高 |
| `docs/technical/design/00-data-model.md` | result 字段已清理、TTS 输出为 .mp3 | 高 |
| `docs/technical/design/04-service-tts.md` | 输出格式 .mp3、audio_durations.json 可能未使用 | 中 |
| `docs/development-plan.md` | Next.js 16 而非 15 | 低 |

### 6.3 新增文档

| 文档 | 内容 | 位置 |
|------|------|------|
| `docs/technical/design/10-task-lifecycle-state-recovery.md` | ✅ 已创建 | `docs/technical/design/` |
| 文档一致性检查清单 | 每次代码变更后对照检查 | 建议作为 CONTRIBUTING.md 附录 |

---

## 七、下一步建议（优先级排序）

### 🔴 P0：修复文档与代码一致性

1. 更新 `07-webui-design.md`：
   - 将目录结构改为实际扁平结构
   - 标注 pause/resume 为"未实现"
   - 标注 `useAutoMode`、`StepCard` 为内联函数
2. 更新 `08-step-lifecycle-control.md`：
   - 在开头添加警告："pause/resume 未实现，仅 stop 可用"
   - 更新 result 存储机制说明
3. 更新 `00-data-model.md`：
   - 删除 `result` 字段描述或标注为"已弃用"
   - 修正 TTS 输出格式为 `.mp3`

### 🟡 P1：实现缺失功能（可选）

| 功能 | 工作量 | 价值 |
|------|--------|------|
| pause/resume | ~4h | 中 — 停止后可重启，pause 只是锦上添花 |
| 步骤直入（上传素材） | ~6h | 中 — 允许跳过前置步骤 |
| 单 shot 重试 UI | ~3h | 低 — 整步重试已可用 |

### 🟢 P2：优化与完善

1. **前端加入 docker-compose**：当前需手动 `npm run dev`
2. **E2E 全链路测试**：MOCK_MODE=true 下跑通完整流程
3. **GPU 真实推理验证**：image-service 已修复，video-service 需调整 Docker 内存

---

## 八、环境信息

| 项目 | 值 |
|------|-----|
| 工作目录 | `D:\work\novel-workflow` |
| MVP 参考代码 | `D:\work\novel-comic-drama-2` |
| 模型文件 | `D:\work\novel-comic-drama\models` |
| GPU | NVIDIA GeForce RTX 5070 Ti Laptop (12GB VRAM) |
| GPU 架构 | Blackwell (sm_120) |
| OS | Windows 11 |
| Docker Desktop | 需调整内存至 24GB（video-service） |

---

## 九、Git 状态

```bash
# 当前分支
develop

# 最新提交
d712971 feat(web): improve UI layout and state validation logic
b06be6e docs: add task lifecycle and state recovery design doc
```

**提交规范**：
- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `refactor:` 重构

---

## 十、交接检查清单

接手 Agent 请确认：

- [ ] 已阅读本文档全部内容
- [ ] 已了解"文档与代码不一致清单"
- [ ] 已确认 pause/resume **未实现**，仅有 stop
- [ ] 已确认产物从**磁盘读取**，非 state.json
- [ ] 已确认 TTS 输出为 `.mp3`，非 `.wav`
- [ ] 已能启动前端 `npm run dev`
- [ ] 已能启动后端 `docker compose up -d`

---

*本文档由 Sisyphus Agent 创建*  
*最后更新：2026-04-20*  
*状态：代码开发完成，文档需同步更新*
