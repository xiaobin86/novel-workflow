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
  "video_prompt": "Static shot. Candle flame flickers gently. Character's fingers slowly turn a page."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `shot_id` | `string` | 格式 `E{ep}_{seq}`，如 `E01_001` |
| `duration` | `number` | 声明时长（秒），实际时长由 TTS 决定 |
| `shot_type` | `enum` | `wide` / `medium` / `close_up` / `extreme_close_up` / `over_shoulder` |
| `camera_move` | `enum` | `static` / `pan` / `zoom_in` / `zoom_out` / `dolly` / `tracking` |
| `scene` | `string` | 场景描述（中文） |
| `characters` | `string[]` | 出场角色名（中文） |
| `emotion` | `string` | 情绪标签（英文，如 `determined` / `sad` / `excited`） |
| `action` | `string` | 旁白/动作文本（中文，用于 TTS 旁白轨） |
| `dialogue` | `string \| null` | 台词（中文，用于 TTS 对话轨），无台词填 `null` |
| `image_prompt` | `string` | 图片生成提示词（英文，用于 FLUX） |
| `video_prompt` | `string` | 视频生成提示词（英文，用于 Wan） |

---

### 1.2 Storyboard（分镜脚本）

```json
{
  "project": {
    "title": "斗破苍穹",
    "episode": "第 1 集",
    "total_shots": 10,
    "total_duration": 40,
    "source_novel": "用户自供"
  },
  "characters": [
    {
      "id": "xiaoyan",
      "name": "萧炎",
      "gender": "男",
      "appearance": "清秀稚嫩脸庞，漆黑眸子..."
    }
  ],
  "shots": [ /* Shot[] */ ],
  "created_at": "2026-04-18T12:00:00Z"
}
```

**字段说明：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `project` | `object` | 项目元数据（title/episode/total_shots/total_duration/source_novel）|
| `characters` | `object[]` | 角色定义数组（id/name/gender/appearance）|
| `shots` | `Shot[]` | 镜头列表 |
| `created_at` | `string` | ISO 8601 时间戳 |

> **注意**：`project_id` 由文件系统路径决定，不存储在 storyboard.json 内部。

---

### 1.3 ProjectState（项目状态）

保存在 `projects/{project_id}/state.json`，是断点续传的核心依据。

```json
{
  "project_id":  "550e8400-e29b-41d4-a716-446655440000",
  "title":       "斗破苍穹",
  "episode":     "E01",
  "created_at":  "2026-04-18T12:00:00Z",
  "steps": {
    "storyboard": {
      "status":     "completed",
      "job_id":     "job_abc123",
      "updated_at": "2026-04-18T12:02:00Z",
      "result": {
        "type": "storyboard",
        "data": { "shot_count": 10, "storyboard_path": "storyboard.json" }
      }
    },
    "image": {
      "status":     "in_progress",
      "job_id":     "job_def456",
      "updated_at": "2026-04-18T12:02:30Z"
      // 注意：result 字段已从 state.json 中移除，产物直接从磁盘读取
    },
    "tts": {
      "status":     "pending",
      "job_id":     null,
      "updated_at": "2026-04-18T12:00:00Z"
    },
    "video": {
      "status":     "pending",
      "job_id":     null,
      "updated_at": "2026-04-18T12:00:00Z"
    },
    "assembly": {
      "status":     "pending",
      "job_id":     null,
      "updated_at": "2026-04-18T12:00:00Z"
    }
  }
}
```

**`status` 枚举值：** `pending` / `in_progress` / `stopped` / `completed` / `failed`

> ⚠️ **架构变更**：`result` 字段已从 `state.json` 中移除，产物信息改为**直接从磁盘读取**（通过 `recoverStepResult()` 函数扫描文件系统）。这样设计的目的是确保 `state.json` 与文件系统不一致时，始终以文件系统为准。
>
> 旧版 `result` 字段结构（仅作参考，已不再使用）：
> | 步骤 | 原 result 结构 |
> |------|-------------|
> | storyboard | `{ type: "storyboard", data: { shot_count, storyboard_path } }` |
> | image | `{ type: "image", data: { images: [{shot_id, filename}], total } }` |
> | tts | `{ type: "tts", data: { audio_files: string[], total_tracks } }` |
> | video | `{ type: "video", data: { clips: [{shot_id, filename, duration}], total } }` |
> | assembly | `{ type: "assembly", data: { video_path, srt_path, duration } }` |

> 各步骤状态统一使用 `{ status, job_id, updated_at }` 结构（无 `result` 字段）。

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

**停止任务**
```
POST /jobs/{job_id}/stop
响应（200 OK）：{ "job_id": "...", "status": "stopped" }
```

### 2.2 模型管理（GPU 服务专用）

```
GET  /model/status   → { "state": "unloaded"|"loading"|"loaded", "loaded_at": "..." }
POST /model/unload   → { "unloaded": true }   （强制卸载，由编排器调用）
```

### 2.3 通用

```
GET /health          → { "status": "ok", "model_state": "loaded"|"unloaded"|"ready"|"busy" }
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
    │   ├── E01_001_action.mp3  ← 旁白音频（tts-service 写，edge-tts 原生输出 mp3）
    │   ├── E01_001_dialogue.mp3 ← 对话音频（tts-service 写，无对话则无此文件）
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
