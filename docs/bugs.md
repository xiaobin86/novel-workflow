# Bug 知识库

> 项目排错经验的长期沉淀。每次通过讨论或搜索定位并解决 bug 后，请把完整闭环追加到本文件。
> 
> 记录格式：
> - 标题：一句话描述现象
> - 日期 / 涉及模块 / 关键词标签
> - 现象 / 根因 / 排查过程 / 解决 / 预防 五段式
> - 如有相关 commit / PR / issue，附上链接

---

## BUG-001: TTS 生成极快且文件极小（Mock 模式 + edge-tts 403）

**日期**: 2026-04-20  
**涉及模块**: `services/tts/`（Docker 容器内 edge-tts）  
**关键词**: `#edge-tts` `#docker-network` `#mock-mode` `#403-forbidden` `#mpeg-audio`

### 现象
- TTS 步骤生成 42 个音频文件仅用时 1 秒
- 每个文件仅 44-64KB，时长约 1.2 秒
- 实际旁白文本有 20-30 个汉字，正常应生成 3-5 秒音频
- 文件大小和时长与文本长度不成比例

### 根因（两层）

**第一层：Mock 模式**
- 容器环境变量 `MOCK_MODE=true`（其他服务均为 `false`）
- `providers/__init__.py` 在 `mock_mode=True` 时返回 `MockTTSProvider`
- `MockTTSProvider.synthesize()` 只 sleep 0.1 秒，生成静音 WAV
- `.env` 文件实际设置 `MOCK_MODE=false`，但容器是在旧值 `true` 时启动的，未随 `.env` 更新

**第二层：edge-tts 403 Forbidden（Docker NAT 网络）**
- 修复 Mock 模式后，edge-tts 调用返回 `WSServerHandshakeError: 403`
- 微软 Edge TTS 服务识别并拒绝了来自 Docker NAT 网络（172.x.x.x）的 WebSocket 请求
- edge-tts 6.1.12 版本已被微软屏蔽，升级到 7.2.8 后正常
- 即使升级后，Docker bridge 网络仍会触发 403，必须使用 `network_mode: host`

### 排查过程与弯路

1. **误判网络不通** → 实际 DNS 和 TCP 都正常，是 WebSocket 握手被拒绝
2. **尝试修改 headers**（User-Agent、Origin）→ 无效，微软在 IP 层面过滤
3. **怀疑版本问题** → 正确方向：6.1.12 被屏蔽，7.2.8 正常
4. **host network 初次测试失败** → 因为容器内仍是 6.1.12，重启后才升级到 7.2.8
5. **发现输出格式变化** → 7.2.8 输出 MPEG Audio（MP3），不是 WAV，`mutagen.wave.WAVE` 无法读取

### 最终解决方案

**文件变更**（3 个 commit）：

1. `c501c50` fix(tts-service): use host network + upgrade edge-tts to bypass 403
   - `docker-compose.yml`: TTS service 添加 `network_mode: host`，端口改 8003
   - `services/tts/Dockerfile`: CMD 支持 `${PORT}` 环境变量
   - `services/tts/requirements.txt`: edge-tts `==6.1.12` → `>=6.1.12`（实际安装 7.2.8）

2. `c553ff9` fix(tts-service): change output from .wav to .mp3
   - `services/tts/job_handler.py`: 
     - 输出扩展名 `.wav` → `.mp3`
     - `mutagen.wave.WAVE` → `mutagen.mp3.MP3`
     - 文件扫描过滤 `.wav` → `.mp3`

3. 清理旧数据：删除项目中所有 `.wav` 文件和 `audio_durations.json`

### 预防建议

1. **环境变量同步检查**：修改 `.env` 后必须 `docker compose up -d --force-recreate` 让容器重新加载环境变量
2. **网络模式文档化**：外部 API 服务（如 edge-tts、Kimi API）在 Docker 中运行时应记录是否需要 host 网络
3. **版本锁定策略**：外部依赖（edge-tts）使用 `>=` 而非 `==`，便于自动获取安全/兼容性更新
4. **输出格式断言**：TTS provider 应在生成后断言输出格式（检查文件头魔术字节），不匹配时报错
5. **健康检查增强**：TTS health endpoint 可尝试调用一次 edge-tts（小文本），提前发现 403 问题
6. **Mock 模式显式标识**：MockProvider 生成的文件应在文件名或元数据中标注 `mock`，避免误用

---

## BUG-002: image-service 模型中途自动卸载（ModelManager TTL）

**日期**: 2026-04-20  
**涉及模块**: `services/image/`  
**关键词**: `#model-manager` `#ttl` `#asyncio-task` `#gpu`

### 现象
- 图片生成到第 10 张左右报错：`RuntimeError: Model not loaded; call load_model() first`
- 错误出现在 `provider.generate_shot()` 调用时
- 不是每次必现，只在生成时间较长的项目中出现

### 根因
- `ModelManager` 有 TTL watchdog，默认 600 秒无活动后自动卸载模型
- `_last_used` 时间戳只在 `model_manager.get()` 中更新
- `job_handler.py` 直接调用 `provider.generate_shot()`，**不经过** `model_manager.get()`
- 每张图约 90 秒，10 张约 15 分钟 > TTL 600 秒 → 模型被自动卸载
- `provider._pipe` 被设为 `None`，但 `job_handler` 仍尝试使用它

### 排查过程
1. 用户提示"是不是模型定期被回收了"→ 正确方向
2. 检查 `model_manager.py` 发现 `_ttl_watchdog` 机制
3. 发现 `_last_used` 更新位置和实际调用路径不一致

### 最终解决方案

**commit**: `5eeec0e` fix(image-service): refresh model TTL before each shot generation

- 在 `job_handler.py` 的 `for shot in shots` 循环中，每次 `generate_shot()` 前调用 `model_manager.get()`
- 刷新 `_last_used` 时间戳，重置 TTL 计时器
- 将 `model_manager` 作为参数传入 `run_generate_images_job()`

```python
# 每次生成前刷新 TTL
if model_manager is not None:
    await model_manager.get()
```

### 预防建议

1. **Provider 接口约定**：所有 GPU provider 的生成方法应在内部调用 `model_manager.get()`，而非依赖调用方
2. **TTL 配置显式化**：在 `.env` 中暴露 `MODEL_TTL_SECONDS`，让用户根据生成速度调整
3. **超时日志**：TTL watchdog 卸载模型前应 WARN 级别日志，便于排查
4. **生成前断言**：`generate_shot()` 开始时应断言 `_pipe is not None`，失败时自动重新加载

---

---

## BUG-003: TTS 启动按钮返回 500，Docker 容器未收到请求

**日期**: 2026-04-20  
**涉及模块**: `services/tts/`、`docker-compose.yml`、`services/tts/providers/edge_tts.py`  
**关键词**: `#docker-network` `#network_mode-host` `#wsl2` `#stale-image` `#mutagen` `#mp3`

### 现象

- 点击页面 TTS 步骤的"开始"按钮，`POST /api/pipeline/{id}/tts/start` 返回 500
- Docker 容器日志无任何请求记录（容器完全没收到请求）
- `docker ps` 显示 tts-service 为 healthy 状态
- 修复网络后再次触发，返回 SSE error 事件：`'ascii' codec can't decode byte 0xff in position 0`

### 根因（两层叠加）

**第一层：`network_mode: host` 在 Docker Desktop + WSL2 下无法被 Windows 侧访问**

BUG-001 的修复方案中为 tts-service 添加了 `network_mode: host`，意图让容器直接使用宿主机网络以绕过 edge-tts 的 403。但在 **Docker Desktop + WSL2** 环境下，`network_mode: host` 的"宿主机"是 **WSL2 虚拟机**，不是 Windows 宿主机。

| 请求路径 | 结果 |
|---|---|
| 容器内 `localhost:8003`（healthcheck） | ✅ 通（在 WSL2 VM 内） |
| Windows 侧 `localhost:8003`（Next.js dev server） | ❌ 不通 |

后续架构重构已将 `docker-compose.yml` 中的 tts-service 还原为桥接网络 + `"8003:8000"` 端口映射，但**运行中的容器未重建**，仍在使用旧的 host network 配置。

**第二层：容器镜像陈旧，`mutagen.wave.WAVE` 读取 MP3 文件崩溃**

重建容器（修复网络）后出现第二个错误。容器镜像是基于旧代码构建的：

```python
# 容器内旧代码（错误）
from mutagen.wave import WAVE
audio = WAVE(output_path)   # edge-tts 7.x 输出 MP3，不是 WAV → InvalidChunk
```

而磁盘上已有修正提交 `65a0479 fix: unify TTS output format from WAV to MP3`：

```python
# 磁盘上正确代码
from mutagen.mp3 import MP3
audio = MP3(output_path)
```

容器镜像未随代码更新重新构建，导致新旧代码不一致。

**补充说明（更正 BUG-001 的结论）**

BUG-001 记录"即使升级 edge-tts，Docker bridge 网络仍会触发 403，必须使用 host 网络"。本次验证发现，**403 的根因是 edge-tts 6.x 版本被微软屏蔽，与网络模式无关**。在 Docker Desktop + WSL2 环境下，bridge 网络和 host 网络的出口公网 IP 相同（均通过 Windows 主机 NAT），微软看到的 IP 一致。使用 edge-tts 7.2.8 + 桥接网络，TTS 可正常工作。

### 排查过程

1. 查看 `docker ps`：tts-service healthy 但**没有端口映射**（其他服务都有 `0.0.0.0:800x->8000/tcp`）
2. 在 Windows 侧 `curl localhost:8003` → 不通；在容器内 `curl localhost:8003` → 通，确认是网络隔离问题
3. 确认 `docker-compose.yml` 已恢复桥接网络，但容器用的是旧配置 → `docker compose up -d --force-recreate tts-service`
4. 网络修复后重新测试，出现新错误：`InvalidChunk: 'ascii' codec can't decode byte 0xff in position 0`
5. 容器内执行 `provider.synthesize()` 复现，traceback 指向 `audio = WAVE(output_path)`（line 48）
6. 对比容器内 vs 磁盘上的 `edge_tts.py`：容器内用 WAVE，磁盘上已改为 MP3
7. `docker compose build tts-service` + `docker compose up -d tts-service` 重建镜像，问题解决

### 解决方案

```bash
# Step 1: 重建容器（让 docker-compose.yml 的桥接网络配置生效）
docker compose up -d --force-recreate tts-service

# Step 2: 重建镜像（让磁盘上已修正的 edge_tts.py 进入容器）
docker compose build tts-service
docker compose up -d tts-service
```

相关已有提交：
- `c501c50` fix(tts-service): use host network + upgrade edge-tts to bypass 403（引入问题的提交，已被后续架构重构还原）
- `65a0479` fix: unify TTS output format from WAV to MP3 across all services（解决 mutagen 问题的提交）

### 预防建议

1. **架构变更后必须重建容器**：`docker-compose.yml` 中涉及 `network_mode`、`ports` 等网络配置的改动，必须执行 `docker compose up -d --force-recreate <service>` 而非普通 restart
2. **代码改动后必须重建镜像**：`services/` 下任何 Python 文件修改后，执行 `docker compose build <service>` 再重启，否则容器运行的是旧镜像
3. **容器内代码验证**：怀疑代码不一致时，用 `docker exec <container> grep -n "关键词" /app/file.py` 快速确认容器内实际代码
4. **`network_mode: host` 在 Windows/WSL2 禁用**：该模式在 Linux 生产环境有效，但在 Docker Desktop + WSL2 开发环境中会导致 Windows 侧服务无法访问容器端口，应改用桥接网络 + ports 映射

---

## BUG-004: video-service Docker 容器 subprocess 黑盒、缺少冷却、配置不足

**日期**: 2026-04-20  
**涉及模块**: `services/video/`（Docker 容器内 Wan2.1 subprocess 调用）  
**关键词**: `#docker` `#video-service` `#subprocess` `#wan2.1` `#pipe-deadlock` `#oom` `#shm_size`

### 现象
- video-service 在 Docker 中运行后，点击"生成视频"无响应或超时
- Docker 日志中看不到 Wan generate.py 的任何输出（黑盒）
- 偶发 CUDA OOM，尤其是在连续生成多个 shot 时
- 容器内 `/dev/shm` 不足导致 PyTorch IPC 警告

### 根因（多层叠加）

**第一层：subprocess 输出黑盒**
- `wan_local.py` 使用 `stdout=PIPE, stderr=PIPE` 捕获输出，但生成完成后仅检查 returncode，未将输出写入日志
- Docker 容器中无法查看 generate.py 的实时输出，排错极其困难
- 长时间运行的 subprocess（~5 分钟）若输出量过大，PIPE 缓冲区存在理论上的 deadlock 风险

**第二层：缺少 shot 间冷却**
- MVP 验证脚本 `batch_generate_wan.py` 明确有 `time.sleep(5)` 段间冷却
- 当前 `job_handler.py` 连续调用 `provider.generate_clip()`，GPU 显存未完全释放即启动下一个 shot
- 12GB VRAM 环境下连续生成 10 个 shot 容易触发 OOM

**第三层：Docker 配置不足**
- `docker-compose.yml` 中 video-service 缺少 `shm_size`（PyTorch 需要共享内存做 IPC）
- 缺少 `CUDA_LAUNCH_BLOCKING=1` 和 `PYTORCH_CUDA_ALLOC_CONF`（image-service 已配置，video-service 遗漏）
- Dockerfile 未设置 `PYTHONUNBUFFERED=1`，日志可能缓冲不实时

**第四层：参数未调优**
- Wan2.1 README 明确推荐 T2V-1.3B 使用 `--sample_guide_scale 6`，当前未设置
- 输出文件仅检查 `size > 0`，MVP 经验表明应检查 `> 1000` 字节以过滤损坏文件

### 排查过程
1. 对比 MVP 脚本 `batch_generate_wan.py` 与当前 `wan_local.py`，发现输出处理和冷却逻辑缺失
2. 检查 `docker-compose.yml`，发现 video-service 的 GPU 相关配置比 image-service 少
3. 检查 Wan2.1 `pyproject.toml` 和 README，发现 `--sample_guide_scale 6` 推荐值未应用
4. 验证 `flash_attn` 为可选依赖（try/except 回退到 `scaled_dot_product_attention`）

### 最终解决方案

**文件变更**（5 个文件）：

1. `services/video/providers/wan_local.py`
   - subprocess 完成后将 stdout/stderr 逐行写入 logger（Docker 可见）
   - 添加 `proc = None` 作用域安全防护
   - 超时后 `try/except` 包裹 `proc.kill()`，防止清理异常吞掉原始错误
   - 添加 `_classify_error()` 解析 stderr：CUDA OOM / checkpoint 缺失 / 依赖缺失
   - 添加 `--sample_guide_scale 6`
   - 输出文件大小阈值从 `> 0` 提升到 `> 1024` 字节

2. `services/video/job_handler.py`
   - shot 循环结束后添加 `asyncio.sleep(SHOT_COOLDOWN_SECONDS)`（默认 5s）
   - 增强 shot 级别日志（开始、成功、冷却）

3. `services/video/Dockerfile`
   - 添加 `ENV PYTHONUNBUFFERED=1`

4. `services/video/requirements.txt`
   - 添加 `numpy>=1.23.5`（Wan2.1 运行时依赖）

5. `docker-compose.yml`
   - video-service 添加 `shm_size: "4gb"`
   - 添加 `PYTHONUNBUFFERED: "1"`
   - 添加 `CUDA_LAUNCH_BLOCKING: "1"`
   - 添加 `PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True"`

### 预防建议

1. **Subprocess 输出不可黑盒**：所有 subprocess 调用完成后必须将 stdout/stderr 写入 logger，Docker 排错依赖此输出
2. **GPU 密集型服务配置对齐**：image-service 和 video-service 的 `shm_size`、`CUDA_LAUNCH_BLOCKING`、`PYTORCH_CUDA_ALLOC_CONF` 必须保持一致
3. **参考 MVP 脚本**：batch_generate_* 脚本中的冷却、验证、日志逻辑应同步到 Docker service 实现
4. **参数紧跟上游文档**：Wan2.1、FLUX 等模型的 README 推荐参数应定期同步到 provider 实现
5. **Docker 重建验证**：修改 `docker-compose.yml` 或 `Dockerfile` 后必须执行 `docker compose build video-service && docker compose up -d video-service`

---

*最后更新：2026-04-20*  
*维护者：Sisyphus Agent*
