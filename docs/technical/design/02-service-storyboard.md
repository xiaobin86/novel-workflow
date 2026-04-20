# 02 — storyboard-service 详细设计

**职责**：将小说文本转换为结构化分镜 JSON  
**端口**：8001  
**GPU**：不需要  
**外部依赖**：Kimi API（云端 LLM）

---

## 1. 内部架构

```
main.py (FastAPI)
│
├── POST /jobs              → job_manager.submit(GenerateStoryboardJob)
├── GET  /jobs/{id}/events  → job_manager.stream(job_id)
├── GET  /jobs/{id}/status  → job_manager.status(job_id)
├── POST /jobs/{id}/pause   → job_manager.pause(job_id)
├── POST /jobs/{id}/resume  → job_manager.resume(job_id)
├── POST /jobs/{id}/stop    → job_manager.stop(job_id)
└── GET  /health

job_manager.py
└── 后台 asyncio.Task 执行 Provider.generate()

providers/
├── base.py         → StoryboardProvider (ABC)
├── kimi.py         → KimiProvider       (v1.0 实现)
└── __init__.py     → get_provider()
```

---

## 2. API 端点

### POST /jobs

**请求体：**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "text": "萧炎缓缓翻开泛黄的古籍...(小说原文)",
  "episode": "E01",
  "title": "斗破苍穹",
  "config": {}
}
```

**响应（202）：**
```json
{
  "job_id": "sb_job_abc123",
  "status": "queued"
}
```

### GET /jobs/{job_id}/events（SSE）

分镜生成是单次 LLM 调用，不按镜头逐步推送，改为推送阶段状态：

```
event: progress
data: {"phase":"calling_llm","message":"正在调用 Kimi API..."}

event: progress
data: {"phase":"parsing","message":"解析分镜 JSON，共 10 个镜头"}

event: complete
data: {"result":{"shot_count":10,"storyboard_path":"storyboard.json"}}
```

---

## 3. Provider 接口

### base.py

```python
from abc import ABC, abstractmethod

class StoryboardProvider(ABC):
    @abstractmethod
    async def generate(
        self,
        text: str,
        episode: str,
        title: str,
        config: dict,
    ) -> list[dict]:
        """
        返回 Shot dict 列表，每个 dict 符合 Shot schema（见 00-data-model.md）
        """
        ...
```

### KimiProvider（v1.0）

**System Prompt 核心规则：**
```
你是专业分镜师。将小说文本转化为 JSON 分镜脚本。

分镜规则：
1. 每次场景切换必须新建镜头
2. 每句对话单独一个镜头
3. 强烈情绪变化触发新镜头
4. image_prompt 必须英文，含画风前缀 "Anime Chinese manhua style, cel-shaded"
5. 每镜头默认 duration=4.0 秒

输出格式：{"shots": [...]}（纯 JSON，不含其他文字）
```

**实现要点：**
- `response_format={"type": "json_object"}` 强制 JSON 输出
- `temperature=0.3` 保证结构稳定
- 重试策略：网络错误最多重试 3 次，指数退避（1s/2s/4s）
- shot_id 由服务侧生成：`f"{episode}_{i+1:03d}"`（不依赖 LLM 生成）

### 预留 Provider（v2.0 不实现，仅定义接口占位）

```python
class OpenAIProvider(StoryboardProvider):
    """使用 GPT-4o 替代 Kimi，接口完全相同"""
    ...

class ClaudeProvider(StoryboardProvider):
    """使用 Claude 替代 Kimi"""
    ...
```

---

## 4. 文件 I/O

| 操作 | 路径 |
|------|------|
| 读取输入 | `/app/projects/{project_id}/input.txt` |
| 写入输出 | `/app/projects/{project_id}/storyboard.json` |

写入时先写临时文件 `storyboard.json.tmp`，成功后 rename，避免写入中途失败留下损坏文件。

---

## 5. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| Kimi API 超时（>30s） | 重试最多 3 次，每次记录日志 |
| JSON 解析失败 | 返回 error 事件，提示用户重试 |
| shots 数组为空 | 视为失败，要求重试（可能是文本太短）|
| 网络不可达 | 立即失败，提示检查 API key 和网络 |

---

## 6. Docker 配置

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```
# requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.6
openai==1.51.0          # Kimi API 兼容 OpenAI SDK
pydantic==2.9.2
httpx==0.27.2
```

**环境变量：**
```
KIMI_API_KEY=...
KIMI_API_BASE=https://api.moonshot.cn/v1
KIMI_MODEL=kimi-k2.5
STORYBOARD_PROVIDER=kimi
```

---

## 7. 处理时序

```
Client                  storyboard-service         Kimi API
  │                            │                       │
  ├─POST /jobs──────────────▶ │                       │
  │◀─202 {job_id}─────────────│                       │
  │                            │                       │
  ├─GET /jobs/{id}/events──▶  │                       │
  │                            ├─chat.completions()──▶ │
  │◀─event:progress(calling)───│                       │
  │                            │◀─JSON response────────│
  │◀─event:progress(parsing)───│                       │
  │                            │  写 storyboard.json   │
  │◀─event:complete────────────│                       │
```

**预期耗时：** ~30-90 秒（取决于文本长度和 Kimi API 响应速度）
