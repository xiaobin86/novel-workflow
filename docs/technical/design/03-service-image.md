# 03 — image-service 详细设计

**职责**：将分镜 JSON 中每个 shot 的 image_prompt 生成对应图片  
**端口**：8002  
**GPU**：必须（FLUX.1-dev，约 6GB VRAM，4-bit NF4 量化后）  
**外部依赖**：无（模型本地加载）

---

## 1. 内部架构

```
main.py (FastAPI)
│
├── POST /jobs               → job_manager.submit(GenerateImagesJob)
├── GET  /jobs/{id}/events   → job_manager.stream(job_id)
├── GET  /jobs/{id}/status   → job_manager.status(job_id)
├── POST /jobs/{id}/pause    → job_manager.pause(job_id)
├── POST /jobs/{id}/resume   → job_manager.resume(job_id)
├── POST /jobs/{id}/stop     → job_manager.stop(job_id)
├── GET  /model/status       → model_manager.status()
├── POST /model/unload       → model_manager.force_unload()
└── GET  /health

job_manager.py              ← 通用 Job 管理（见 01-services-overview.md）

model_manager.py            ← GPU 模型生命周期（见 01-services-overview.md）
└── 管理 FLUX pipeline 实例

providers/
├── base.py                 → ImageProvider (ABC)
├── flux_local.py           → FluxLocalProvider (v1.0 实现)
└── __init__.py             → get_provider()
```

---

## 2. API 端点

### POST /jobs

**请求体：**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "config": {
    "width": 768,
    "height": 768,
    "num_inference_steps": 28,
    "guidance_scale": 3.5
  }
}
```

> `storyboard.json` 从共享卷读取，不在请求体中传输。

**响应（202）：**
```json
{
  "job_id": "img_job_xyz456",
  "status": "queued"
}
```

### GET /jobs/{job_id}/events（SSE）

按镜头逐个推送（每张图片生成完成后立即推送）：

```
event: progress
data: {"shot_id":"E01_001","done":1,"total":10,"message":"Generated E01_001.png","skipped":false}

event: progress
data: {"shot_id":"E01_002","done":2,"total":10,"message":"Skipped (already exists)","skipped":true}

event: complete
data: {"result":{"images":[{"shot_id":"E01_001","filename":"E01_001.png"},...],"total":10,"skipped":2}}
```

---

## 3. Provider 接口

### base.py

```python
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

class ImageProvider(ABC):
    @abstractmethod
    async def generate_shot(
        self,
        shot_id: str,
        prompt: str,
        output_path: str,
        config: dict,
    ) -> None:
        """
        生成单张图片并保存到 output_path。
        已存在则由调用方跳过，不由 Provider 判断。
        """
        ...

    @abstractmethod
    async def load_model(self) -> None:
        """加载模型到 GPU（由 ModelManager 调用）"""
        ...

    @abstractmethod
    async def unload_model(self) -> None:
        """释放 GPU 显存（由 ModelManager 调用）"""
        ...
```

### FluxLocalProvider（v1.0）

**模型加载（约 2 分钟，仅首次）：**
```python
from diffusers import FluxPipeline
import torch
from transformers import BitsAndBytesConfig

async def load_model(self):
    # 4-bit NF4 量化：23GB → ~6GB VRAM
    nf4_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    self.pipe = FluxPipeline.from_pretrained(
        "/app/models/FLUX.1-dev",
        quantization_config=nf4_config,
        torch_dtype=torch.bfloat16,
    )
    self.pipe.enable_model_cpu_offload()
    self.pipe.vae.enable_slicing()
    self.pipe.vae.enable_tiling()
```

**单张图片生成（约 90 秒/张）：**
```python
async def generate_shot(self, shot_id, prompt, output_path, config):
    # 在线程池中执行（避免阻塞事件循环）
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, self._sync_generate, prompt, output_path, config)

def _sync_generate(self, prompt, output_path, config):
    image = self.pipe(
        prompt=prompt,
        width=config.get("width", 768),
        height=config.get("height", 768),
        num_inference_steps=config.get("num_inference_steps", 28),
        guidance_scale=config.get("guidance_scale", 3.5),
    ).images[0]
    image.save(output_path)
```

**模型卸载：**
```python
async def unload_model(self):
    del self.pipe
    self.pipe = None
    torch.cuda.empty_cache()
    import gc; gc.collect()
```

### 预留 Provider（v2.0 不实现）

```python
class ReplicateProvider(ImageProvider):
    """通过 Replicate API 调用 FLUX，无需本地 GPU"""
    ...

class FalProvider(ImageProvider):
    """通过 fal.ai API 调用 FLUX"""
    ...
```

---

## 4. 核心处理流程

```python
async def run_generate_images_job(job: JobRecord, project_id: str, config: dict):
    project_dir = Path(f"/app/projects/{project_id}")
    storyboard = json.loads((project_dir / "storyboard.json").read_text())
    shots = storyboard["shots"]
    images_dir = project_dir / "images"
    images_dir.mkdir(exist_ok=True)

    job.total = len(shots)
    provider = model_manager.get_provider()  # 触发按需加载

    for i, shot in enumerate(shots):
        shot_id = shot["shot_id"]
        output_path = images_dir / f"{shot_id}.png"

        # 断点续传：文件已存在则跳过
        if output_path.exists() and output_path.stat().st_size > 0:
            job.done += 1
            await job.emit_progress(shot_id, skipped=True)
            continue

        try:
            await provider.generate_shot(
                shot_id=shot_id,
                prompt=shot["image_prompt"],
                output_path=str(output_path),
                config=config,
            )
            job.done += 1
            await job.emit_progress(shot_id, skipped=False)
        except Exception as e:
            await job.emit_error(shot_id, str(e), retryable=True)
            # 单张失败不中断整个 Job，继续处理下一张
            continue

    await job.emit_complete({"images": [...]})
```

---

## 5. 文件 I/O

| 操作 | 路径 |
|------|------|
| 读取分镜 | `/app/projects/{project_id}/storyboard.json` |
| 写入图片 | `/app/projects/{project_id}/images/{shot_id}.png` |
| 模型路径 | `/app/models/FLUX.1-dev/`（只读挂载） |

---

## 6. 关键参数默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| width | 768 | 输出图片宽度（px） |
| height | 768 | 输出图片高度（px） |
| num_inference_steps | 28 | 去噪步数，越高质量越好但越慢 |
| guidance_scale | 3.5 | FLUX 推荐值 |

---

## 7. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| CUDA OOM（单张） | 发送 error 事件（retryable=true），继续下一张 |
| CUDA OOM（持续） | Job 整体失败，建议减小分辨率或重启服务 |
| 模型文件缺失 | 启动时检测，health 返回 503 |
| 推理超时（>5min） | 取消当前推理，视为单张失败 |

---

## 8. Docker 配置

```dockerfile
FROM pytorch/pytorch:2.7.0-cuda12.8-cudnn9-devel
WORKDIR /app
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```
# requirements.txt（关键依赖）
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
diffusers>=0.33.1
transformers==4.51.3
accelerate==1.3.0
bitsandbytes==0.49.2
torch==2.7.0            # 由基础镜像提供
Pillow>=10.0.0
```

**环境变量：**
```
IMAGE_PROVIDER=flux_local
MODEL_TTL_SECONDS=600       # 空闲 10 分钟后自动卸载
```

---

## 9. 处理时序

```
时间（相对值）  事件
t=0            Client: POST /jobs → 202 {job_id}
t=0            Client: GET /jobs/{id}/events (SSE 连接建立)
t=0            后台 Task 启动，调用 model_manager.get()
t=0~120s       FLUX 模型加载中（首次，约 2min）
t=120s         模型就绪，开始处理 Shot E01_001
t=210s         E01_001 完成 → emit progress(done=1)
t=300s         E01_002 完成（若已存在则立即 skip）→ emit progress(done=2)
...
t=120+10×90s  全部 10 个 Shot 完成 → emit complete
               编排器调用 POST /model/unload
```

**预期耗时（10 shots，无缓存）：** 约 15-20 分钟（含首次模型加载 2min）
