# 00 — 共享数据模型

所有服务和 Next.js 使用同一套数据契约。本文档是唯一权威来源。

---

## 1. 核心实体

### 1.1 Shot（镜头）

所有服务的最小处理单元。

```json
{
  "shot_id":      "E01_001",
  "duration":     4.0,
  "shot_type":    "medium",
  "camera_move":  "static",
  "scene":        "古代藏书阁，烛光摇曳",
  "characters":   ["萧炎"],
  "emotion":      "determined",
  "action":       "萧炎缓缓翻开泛黄的古籍，眉头微皱。",
  "dialogue":     null,
  "image_prompt": "Anime Chinese manhua style, cel-shaded flat colors. Young man with dark hair in ancient robes, reading an old scroll in a candlelit library. Determined expression. Warm amber lighting.",
  "video_prompt": "Static shot. Candle flame flickers gently. Character's fingers slowly turn a page.",
  "bgm_mood":     "peaceful"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `shot_id` | `string` | 格式 `E{ep}_{seq}`，如 `E01_001` |
| `duration` | `number` | 声明时长（秒），实际时长由 TTS 决定 |
| `shot_type` | `enum` | `wide` / `medium` / `close` / `extreme_close` |
| `camera_move` | `enum` | `static` / `pan` / `zoom_in` / `zoom_out` / `track` |
| `scene` | `string` | 场景描述（中文） |
| `characters` | `string[]` | 出场角色名（中文） |
| `emotion` | `string` | 情绪标签（英文，如 `determined` / `sad` / `excited`） |
| `action` | `string` | 旁白/动作文本（中文，用于 TTS 旁白轨） |
| `dialogue` | `string \| null` | 台词（中文，用于 TTS 对话轨），无台词填 `null` |
| `image_prompt` | `string` | 图片生成提示词（英文，用于 FLUX） |
| `video_prompt` | `string` | 视频生成提示词（英文，用于 Wan） |
| `bgm_mood` | `enum` | `peaceful` / `battle` / `sad` / `epic`（v1.0 保留字段，不使用） |

---

### 1.2 Storyboard（分镜脚本）

```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "title":      "斗破苍穹",
  "episode":    "E01",
  "shots":      [ /* Shot[] */ ],
  "created_at": "2026-04-18T12:00:00Z"
}
```

---

### 1.3 ProjectState（项目状态）

保存在 `projects/{project_id}/state.json`，是断点续传的核心依据。

```json
{
  "project_id":  "550e8400-e29b-41d4-a716-446655440000",
  "title":       "斗破苍穹",
  "episode":     "E01",
  "created_at":  "2026-04-18T12:00:00Z",
  "updated_at":  "2026-04-18T13:30:00Z",
  "pipeline": {
    "storyboard": {
      "status":       "completed",
      "completed_at": "2026-04-18T12:02:00Z",
      "shot_count":   10
    },
    "image": {
      "status":           "in_progress",
      "started_at":       "2026-04-18T12:02:30Z",
      "completed_shots":  ["E01_001", "E01_002", "E01_003"],
      "failed_shots":     [],
      "total_shots":      10
    },
    "tts": {
      "status":           "in_progress",
      "started_at":       "2026-04-18T12:02:30Z",
      "completed_shots":  ["E01_001", "E01_002"],
      "failed_shots":     [],
      "total_shots":      10
    },
    "video": {
      "status": "pending"
    },
    "assembly": {
      "status": "pending"
    }
  }
}
```

**`status` 枚举值：** `pending` / `in_progress` / `completed` / `failed`

> image 和 tts 可同时处于 `in_progress`（并行执行），其余步骤严格串行。

---

## 2. 服务 API 契约

### 2.1 Job（异步任务）

所有长耗时操作均通过 Job 模式执行。

**提交任务**
```
POST /jobs
Content-Type: application/json

请求体：各服务自定义（见各服务文档）
响应（202 Accepted）：
{
  "job_id": "job_abc123",
  "status": "queued"
}
```

**订阅进度（SSE）**
```
GET /jobs/{job_id}/events
Accept: text/event-stream

流式响应：
event: progress
data: {"shot_id":"E01_001","done":1,"total":10,"message":"Generating..."}

event: progress
data: {"shot_id":"E01_002","done":2,"total":10,"message":"Generating..."}

event: complete
data: {"result": { /* 各服务自定义结果体 */ }}

event: error
data: {"shot_id":"E01_003","message":"CUDA OOM","retryable":true}
```

**查询状态**
```
GET /jobs/{job_id}/status
响应：
{
  "job_id":   "job_abc123",
  "status":   "in_progress",
  "done":     3,
  "total":    10,
  "result":   null,
  "error":    null
}
```

**取消任务**
```
DELETE /jobs/{job_id}
响应（200 OK）：{ "cancelled": true }
```

### 2.2 模型管理（GPU 服务专用）

```
GET  /model/status   → { "state": "unloaded"|"loading"|"loaded", "loaded_at": "..." }
POST /model/unload   → { "unloaded": true }   （强制卸载，由编排器调用）
```

### 2.3 通用

```
GET /health          → { "status": "ok", "model_state": "loaded"|"unloaded" }
```

---

## 3. 文件系统布局

所有服务挂载同一个宿主机目录（`./projects`），路径约定如下：

```
projects/
└── {project_id}/
    ├── state.json              ← 项目状态（Next.js 读写）
    ├── input.txt               ← 原始小说文本
    ├── storyboard.json         ← 分镜脚本（storyboard-service 写）
    ├── images/
    │   ├── E01_001.png         ← 每镜头图片（image-service 写）
    │   └── ...
    ├── audio/
    │   ├── E01_001_action.wav  ← 旁白音频（tts-service 写）
    │   ├── E01_001_dialogue.wav ← 对话音频（tts-service 写，无对话则无此文件）
    │   └── ...
    ├── clips/
    │   ├── E01_001.mp4         ← 视频片段（video-service 写）
    │   └── ...
    └── output/
        ├── final.mp4           ← 最终成片（assembly-service 写）
        └── final.srt           ← 字幕文件（assembly-service 写）
```

**断点续传规则（所有服务通用）：**  
服务处理每个 shot 前，先检查目标文件是否已存在且完整（文件大小 > 0）。若存在则跳过，直接标记为已完成并继续下一个 shot。

---

## 4. 错误码

| HTTP 状态 | 场景 |
|-----------|------|
| 202 | Job 已接受，开始处理 |
| 400 | 请求参数错误（缺字段、格式错误） |
| 404 | Job 不存在 |
| 409 | Job 已存在（重复提交同一 project_id + step） |
| 500 | 服务内部错误 |
| 503 | 模型正在加载，暂时不可用 |
