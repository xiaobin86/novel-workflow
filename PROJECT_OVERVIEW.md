# 小说漫剧生成平台 — 项目概况

> 基于 `novel-comic-drama-2` MVP 验证成果，构建可视化 Web 应用

---

## 一、已验证的 MVP 能力（novel-comic-drama-2）

MVP 已成功将斗破苍穹第一章（约 2700 汉字）处理为一段 **40 秒动漫风格短视频**，完整跑通了从文字到成片的全流程。

### 处理时间参考

| 步骤 | 耗时 | 输出 |
|------|------|------|
| 小说 → 分镜 JSON | ~2 min | 10 个镜头 |
| 分镜 → 图片（FLUX） | ~15 min | 10×768px PNG |
| 分镜 → 音频（TTS） | ~3 min | 旁白 + 对话 WAV |
| 分镜 → 视频片段（Wan） | ~50 min | 10×832×480 MP4 |
| 素材拼装（FFmpeg） | ~1 min | 最终 MP4+SRT |
| **全流程** | **~70 min** | 40s 成片 |

---

## 二、核心管线架构

```
小说文本（.txt）
    │
    ▼  [Step 1] Kimi API (kimi-k2.5)
分镜 JSON
├── shot_id, duration, shot_type, camera_move
├── scene, characters, emotion
├── action（旁白文本）
├── dialogue（台词文本）
├── image_prompt（英文，给 FLUX）
└── video_prompt（英文，给 Wan）
    │
    ├──▶ [Step 2] FLUX.1-dev（本地 GPU）→ 768×768 PNG
    ├──▶ [Step 3] edge-tts（Azure 免费）→ 旁白 WAV + 对话 WAV
    │
    ▼  [Step 4] Wan2.1-T2V-1.3B（本地 GPU，串行）
视频片段 MP4（832×480，65帧≈4s/片）
    │
    ▼  [Step 5] FFmpeg 拼装
最终 MP4 + SRT 字幕
```

### 关键约束（来自 MVP 踩坑）

- **GPU 串行**：12GB VRAM，FLUX 和 Wan 不能并行；每步需完整卸载前一个模型
- **TTS 驱动时长**：视频片段按 `max(声明时长, TTS时长 + 0.5s)` 自适应拉伸，避免旁白被截断
- **FFmpeg concat demuxer**：多片段拼接必须用 concat demuxer，xfade 超过 3 片段会丢内容
- **格式要求**：输出必须加 `-pix_fmt yuv420p`，否则部分播放器不兼容

---

## 三、AI 服务选型

| 模块 | 服务 | 方式 | 备注 |
|------|------|------|------|
| 分镜生成 | Kimi API（kimi-k2.5） | 云端 API | Anthropic SDK 兼容格式 |
| 图片生成 | FLUX.1-dev | 本地 GPU | 4-bit NF4 量化，~6GB VRAM |
| 视频生成 | Wan2.1-T2V-1.3B | 本地 GPU | 原格式 16.6GB，~50min/10片段 |
| 旁白 TTS | edge-tts | 本地调用 Azure | 免费，YunxiNeural 等 |
| 对话 TTS | edge-tts | 按角色映射声线 | 可配置每个角色对应声线 |
| BGM | 程序合成 / 本地文件 | 本地 | 五声音阶，4 种情绪变体 |
| 视频拼装 | FFmpeg | 本地 CLI | 系统 PATH 需包含 |

---

## 四、Web 应用目标设计

### 核心体验

以 **向导流程（Wizard）** 方式引导用户逐步完成创作，同时支持 **从任意步骤切入**（只要该步骤的输入满足格式要求）。

### 五个步骤及其 I/O 契约（v1.0 实际实现）

```
Step 1  分镜生成（storyboard）
        输入：.txt 文件 / 粘贴文本
        输出：storyboard.json（每个镜头含 image_prompt、action、dialogue 等）

Step 2  图片生成（image，并行 Step 3）
        输入：storyboard.json
        输出：每个 shot 对应的 PNG/JPG/WebP 图片

Step 3  TTS 音频生成（tts，与 Step 2 并行）
        输入：storyboard.json
        输出：每个 shot 的旁白 + 对话 MP3 音频

Step 4  视频片段生成（video）
        输入：storyboard.json + PNG 图片 + TTS 音频时长
        输出：每个 shot 对应的 MP4 片段

Step 5  素材拼装（assembly）
        输入：MP4 片段 + MP3 音频
        输出：最终 MP4 + SRT 字幕
```

### 功能特性

- **实时进度**：长耗时任务（图片/视频生成）展示逐条进度，支持取消
- **检查点恢复**：每步完成写入 `.pipeline_state.json`，中途中断可从最后完成步骤继续
- **预览**：每步完成后可在界面预览当前产物（图片网格、音频波形、视频播放）
- **参数配置**：每步可调整关键参数（风格 Prompt、TTS 声线、BGM 情绪、视频分辨率等）
- **项目管理**：历史项目列表，可复用分镜继续生成

---

## 五、技术方案（已确定，截至 2026-04-20）

### 后端

- **FastAPI** + asyncio background tasks（5 个 Docker 微服务）
- 长任务通过 **SSE（Server-Sent Events）** 推送进度
- 不使用 Celery/Redis（单用户场景 asyncio 足够）

### 前端

- **Next.js 15（App Router）** — 全栈方案，API Routes 作为后端代理
- shadcn/ui + Tailwind CSS
- SWR 状态轮询 + EventSource SSE 实时进度

### 存储

- 本地文件系统（`projects/{project_id}/` 目录结构）
- 无数据库（项目元数据直接存 state.json）

### 已解决的核心问题

1. ✅ **前后端一体化**：Next.js 15 全栈（API Routes 代理到各 Docker 服务）
2. ✅ **任务队列方案**：asyncio 足够（单用户，无需 Celery + Redis）
3. ✅ **仅本地 GPU**：v1.0 只实现本地，Provider 接口预留云端扩展
4. ✅ **单用户本地**：无多用户需求，无需 SaaS 架构
5. ✅ **分镜编辑**：v1.0 只支持预览，如需修改直接编辑 JSON 文件

---

## 六、参考资源

- MVP 实现：`D:/work/novel-comic-drama-2/`
- 踩坑文档：`RESEARCH_SUMMARY.md`（本目录）
- 核心脚本：
  - `storyboard_generator.py` — 分镜生成
  - `batch_generate_flux.py` — 图片生成
  - `batch_generate_wan.py` — 视频生成
  - `generate_audio.py` — TTS 生成
  - `video_assembler.py` — 最终拼装
  - `generate_bgm.py` — BGM 合成
