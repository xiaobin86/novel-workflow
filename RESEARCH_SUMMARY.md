# 小说漫剧自动化 Pipeline - 研究成果摘要

> 本文档记录从小说文本到漫剧视频的端到端自动化 pipeline 的所有技术发现、方案选择和踩坑记录。
> 目标：确保在 `novel-workflow` 项目中能复用当前研究成果，避免重复踩坑。

---

## 一、硬件环境

| 项目 | 配置 |
|------|------|
| GPU | NVIDIA RTX 5070 Ti Laptop (12GB VRAM) |
| GPU架构 | Blackwell (sm_120) |
| CPU | x86_64 |
| RAM | 32GB |
| OS | Windows 11 |
| Python | 3.12 |

### 关键发现
1. **RTX 5070 Ti = sm_120 (Blackwell)**，需要 **PyTorch 2.7.0+cu128**（第一个支持Blackwell的稳定版）
2. **Windows 不支持 torch.compile**（无 Triton），FLUX脚本已自动跳过
3. **12GB 显存无法同时加载 FLUX(~12GB) + Wan(~12GB)**，必须**串行工作流**
4. **峰值显存需控制在 <9GB**，保障其他应用可用

---

## 二、模型与依赖

### PyTorch 安装
```powershell
pip install torch==2.7.0+cu128 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

### 关键依赖版本
| 包 | 版本 | 说明 |
|----|------|------|
| torch | 2.7.0+cu128 | Blackwell支持 |
| diffusers | 0.33.1 | 支持 WanPipeline |
| transformers | 4.51.3 | T5编码器 |
| bitsandbytes | 0.49.2 | 4-bit量化 |
| edge-tts | 最新 | 配音生成 |
| ffmpeg-python | 最新 | FFmpeg包装 |

### 外部工具
- **FFmpeg 8.1+**（必须添加到系统PATH）

---

## 三、模型配置

### 3.1 FLUX.1-dev（图片生成）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 路径 | `models/FLUX.1-dev/` | 本地模型 |
| 大小 | ~22GB | 完整模型 |
| 量化 | 4-bit NF4 (BitsAndBytes) | transformer 从23GB压至~6GB |
| offload | model_cpu_offload | 按组件搬运，比sequential快10倍 |
| 分辨率 | 768x768 | 生成图片尺寸 |
| 步数 | 15 | 推理步数 |
| guidance_scale | 3.5 | 引导系数 |
| max_sequence_length | 256 | T5文本长度 |

**显存优化策略：**
- `ENABLE_MODEL_CPU_OFFLOAD = True`（组件级CPU/GPU卸载）
- `ENABLE_VAE_TILING = True`（VAE分块解码）
- `ENABLE_VAE_SLICING = True`（VAE切片）
- `USE_4BIT_QUANTIZATION = True`（核心优化）

### 3.2 Wan2.1-T2V-1.3B（视频生成）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 格式 | 原生格式（非diffusers） | `models/Wan2.1-T2V-1.3B/` |
| 大小 | 16.6GB | 含T5+VAE+DiT |
| 分辨率 | 832x480 | 推荐尺寸 |
| 帧率 | 16fps | 固定 |
| frame_num | 65（4秒） | 4n+1格式 |
| sample_steps | 20 | 推理步数 |
| sample_shift | 8 | 采样偏移 |
| offload_model | True | 模型卸载到CPU |
| t5_cpu | True | T5放在CPU |

**重要：**
- diffusers 0.32.2 不支持 WanPipeline，必须升级到 0.33.0+
- 原生格式比 diffusers 格式（27GB）更省RAM，32GB RAM加载27GB会失败
- 每段4秒生成时间约 **5分钟**

### 3.3 注意力机制修复

**问题：** 原生Wan代码默认调用 `flash_attention()`，Windows上未安装 `flash_attn` 库会导致 `AssertionError`

**修复方案：**
修改 `Wan2.1/wan/modules/attention.py` 中 `flash_attention()` 函数，将 `assert FLASH_ATTN_2_AVAILABLE` 改为条件判断 + fallback 到 `torch.nn.functional.scaled_dot_product_attention`

---

## 四、Pipeline 流程

### 4.1 完整流程（串行）

```
小说文本 → 分镜JSON → FLUX图片 → Wan视频 → 配音/旁白 → FFmpeg合成
```

### 4.2 各步骤标准输入输出

| 步骤 | 输入 | 输出 | 耗时 |
|------|------|------|------|
| ① 分镜生成 | `chapter_input.txt` | `storyboard.json` | ~2分钟 |
| ② FLUX出图 | `storyboard.json` | `output_images/E01_*.png` | ~15分钟/10张 |
| ③ 音频生成 | `storyboard.json` | `audio/E01_*.wav` + `audio/E01_*_action.wav` | ~3分钟 |
| ④ Wan视频 | `storyboard.json` + 图片 | `clips/E01_*_wan.mp4` | ~50分钟/10段 |
| ⑤ FFmpeg合成 | 视频+音频+BGM | `final_mvp.mp4` + `final_mvp.srt` | ~1分钟 |

### 4.3 分镜JSON结构

```json
{
  "project": {
    "title": "小说名称",
    "episode": 1,
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
  "shots": [
    {
      "shot_id": "E01_001",
      "duration": 4,
      "shot_type": "close-up",
      "camera_move": "static",
      "scene": "萧家广场测验台",
      "characters": ["xiaoyan"],
      "action": "萧炎面无表情凝视魔石碑...",
      "emotion": "自嘲、痛苦",
      "dialogue": "斗之力，三段！",
      "image_prompt": "Close-up, teenage boy with...",
      "video_prompt": "Static close-up..."
    }
  ]
}
```

---

## 五、TTS 与视频对齐策略（核心发现）

### 5.1 问题背景

旁白 TTS（action 字段朗读）时长通常超过声明的 4 秒/镜。例如：
- E01_001: action TTS = 5.9s，声明 duration = 4s
- E01_003: action TTS = 7.4s，声明 duration = 4s
- E01_008: action TTS = 6.9s，声明 duration = 4s

如果视频固定 4 秒，TTS 会被截断，导致旁白不完整。

### 5.2 解决方案

**自适应延长策略：**
```
实际视频时长 = max(声明时长, TTS时长 + 0.5s缓冲)
```

**实现方式：**
1. 先读取所有 action TTS 音频文件，获取实际时长
2. 对每个 shot 计算：`actual_duration = max(declared, tts_duration + 0.5)`
3. 使用 FFmpeg `tpad=stop_mode=clone:stop_duration=X` 冻结最后一帧来延长视频
4. 音频时间偏移基于**实际时长**累加计算

**效果：**
- 原总时长 40s → 自适应后 57.7s
- 所有 TTS 完整播放，不会被截断
- 视频结尾静止帧填充，视觉上自然

### 5.3 音轨混合策略

| 音轨 | 来源 | 音量 | 说明 |
|------|------|------|------|
| 旁白 (action) | edge-tts朗读action字段 | 100% | 每个分镜都有 |
| 配音 (dialogue) | edge-tts朗读dialogue字段 | 0%（当前关闭） | 有对白的分镜 |
| BGM | Python合成或外部下载 | 0%（当前关闭） | 循环播放，背景氛围 |

**混合公式（FFmpeg）：**
```
[旁白]adelay=xxx,volume=1.0 +
[配音]adelay=xxx,volume=0.0 +
[BGM]aloop=loop=-1,volume=0.0
→ amix混合
```

**注意：** 旁白和配音从**每段开头**同时开始播放。如果两者同时存在，建议旁白100%、配音0%（或反之），避免重叠混乱。

---

## 六、视频片段合并策略

### 6.1 方案对比

| 方案 | 命令 | 优点 | 缺点 |
|------|------|------|------|
| concat demuxer | `ffmpeg -f concat -safe 0 -i list.txt` | 100%可靠，不丢片段 | 硬切换，无过渡 |
| xfade 滤镜 | `-filter_complex xfade=transition=fade` | 有淡入淡出效果 | 多段链接时不稳定，offset计算复杂易出错 |

### 6.2 当前选择

**使用 concat demuxer**，原因：
- xfade 在多段（>3段）链接时，`offset` 参数需要精确计算累积时长减去过渡重叠，极易出错
- 实测 10 段 xfade 链接后总时长从 40s 变成 32s，丢失了部分内容
- concat 直接拼接可保证所有片段 100% 完整播放

**"呼吸感"替代方案：**
- 不需要视频层面的 fade 过渡
- 通过自适应延长策略，让每段时长自然变化（4~8秒不等），本身就避免了机械感
- 如需进一步改善，可在分镜生成时加入 0.5~1s 的 "留白镜"

---

## 七、BGM 方案

### 7.1 Python 合成 BGM

采用中国五声音阶（宫商角徵羽 = C D E G A），生成 4 种风格：
- **宁静古风**（peaceful）：古筝音色，慢节奏，适合日常/修炼场景
- **战斗古风**（battle）：笛子音色+鼓点，快节奏
- **悲伤古风**（sad）：低音区笛子，慢节奏，长音符
- **大气古风**（epic）：古筝+低音铺垫，适合开篇

### 7.2 音量控制

BGM 音量必须极低，避免干扰旁白：
- 推荐音量：**5%~8%**（volume=0.05~0.08）
- 当前配置：0%（BGM 关闭，仅保留旁白）

---

## 八、踩坑记录

### 8.1 已修复

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| flash_attn AssertionError | Windows未安装flash_attn | attention.py fallback到PyTorch标准attention |
| 视频只播放一段 | xfade offset计算错误 | 改用concat demuxer |
| TTS被截断 | 视频固定4s，TTS更长 | 自适应延长：actual=max(declared, tts+0.5) |
| 音频时间不同步 | 延迟基于声明时长计算 | 改为基于实际时长累加 |
| 字幕路径解析错误 | Windows反斜杠被FFmpeg解释为转义 | 使用as_posix() + replace(':','\\:') |
| 32GB RAM加载27GB模型失败 | diffusers格式过大 | 改用原生Wan格式（16.6GB） |
| 动漫风格漂移 | Wan训练数据偏真实照片 | prompt前缀强化动漫风格词 |
| 播放器无法打开 | yuv444p像素格式不兼容 | 强制 `-pix_fmt yuv420p` |
| edge-tts输出格式 | 扩展名.wav但内容mp3 | FFmpeg可直接处理，无需转换 |

### 8.2 待优化

- [ ] Wan视频生成速度优化（当前5分钟/4秒片段）
- [ ] 风格一致性进一步提升（考虑I2V首帧条件）
- [ ] BGM智能匹配（根据情绪自动选择BGM风格）
- [ ] 模块化重构（支持断点续作）
- [ ] Web UI可视化界面

---

## 九、关键命令速查

### 环境检查
```powershell
# PyTorch + CUDA
python -c "import torch; print(f'PyTorch {torch.__version__}, CUDA {torch.version.cuda}')"

# FFmpeg
ffmpeg -version
```

### 时长检查
```powershell
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4
```

### 视频延长（冻结最后一帧）
```powershell
ffmpeg -y -i input.mp4 -vf "tpad=stop_mode=clone:stop_duration=2.5" -an -c:v libx264 output.mp4
```

### concat 拼接
```powershell
# 创建 list.txt，每行：file 'path/to/video.mp4'
ffmpeg -y -f concat -safe 0 -i list.txt -c:v libx264 -crf 23 -preset fast -pix_fmt yuv420p -an output.mp4
```

---

## 十、未来计划（novel-workflow项目）

### 10.1 模块化Pipeline（5步独立）

```
Step 1: Text → Storyboard
  Input: novel_chapter.txt
  Output: storyboard.json
  
Step 2: Storyboard → Images
  Input: storyboard.json + characters.json
  Output: output_images/*.png
  
Step 3: Storyboard → Audio
  Input: storyboard.json
  Output: audio/*_action.wav + audio/*.wav + bgm/*.wav
  
Step 4: Storyboard + Images → Videos
  Input: storyboard.json + output_images/*.png
  Output: clips/*_wan.mp4
  
Step 5: Final Assembly
  Input: clips/*.mp4 + audio/*.wav + bgm/*.wav + storyboard.json
  Output: final.mp4 + final.srt
```

### 10.2 断点续作支持

- 每个步骤完成后写入 `.pipeline_state.json`
- 重新运行时检查状态，跳过已完成步骤
- 支持从任意步骤开始执行

### 10.3 Web UI 功能规划

- [ ] 流程图可视化（各步骤状态）
- [ ] 拖拽/上传标准输入文件
- [ ] 实时查看生成进度
- [ ] 历史项目管理
- [ ] 参数配置界面
- [ ] 预览功能（图片/视频/音频）

---

*本文档由 Sisyphus Agent 生成*
*项目阶段：MVP验证通过，准备模块化重构*
