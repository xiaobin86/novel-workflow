import asyncio
import json
import logging
import os
import time

from openai import AsyncOpenAI

from .base import StoryboardProvider

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是专业分镜师。将小说文本转化为 JSON 分镜脚本。

分镜规则：
1. 每次场景切换必须新建镜头
2. 每句对话单独一个镜头
3. 强烈情绪变化触发新镜头
4. image_prompt 必须英文，含画风前缀 "Anime Chinese manhua style, cel-shaded, flat colors, 2D animation, clean lineart."
5. video_prompt 必须英文，描述镜头运动和画面动态
6. 每镜头默认 duration=4.0 秒
7. shot_type 从 [wide, medium, close_up, extreme_close_up, over_shoulder] 中选
8. camera_move 从 [static, pan, zoom_in, zoom_out, dolly, tracking] 中选
9. emotion 使用英文情绪词（如 determined, sad, excited, calm）
10. 无台词时 dialogue 填 null

输出格式（纯 JSON，不含其他文字）：
{
  "project": {"title": "...", "episode": "...", "total_shots": N, "total_duration": N, "source_novel": "用户自供"},
  "characters": [{"id": "...", "name": "...", "gender": "男/女", "appearance": "..."}],
  "shots": [
    {
      "shot_type": "medium",
      "camera_move": "static",
      "scene": "场景描述（中文）",
      "characters": ["角色名"],
      "emotion": "determined",
      "action": "旁白/动作文本（中文）",
      "dialogue": null,
      "image_prompt": "Anime Chinese manhua style... (English)",
      "video_prompt": "Static shot... (English)",
      "duration": 4.0
    }
  ],
  "created_at": "ISO8601时间"
}"""


class KimiProvider(StoryboardProvider):
    MAX_RETRIES = 3

    def __init__(self):
        api_key = os.getenv("KIMI_API_KEY", "")
        api_base = os.getenv("KIMI_API_BASE", "https://api.moonshot.cn/v1")
        self._model = os.getenv("KIMI_MODEL", "moonshot-v1-8k")
        self._client = AsyncOpenAI(api_key=api_key, base_url=api_base)

    async def generate(self, text: str, episode: str, title: str, config: dict) -> list[dict]:
        user_msg = f"小说标题：{title}\n集数：{episode}\n\n原文：\n{text}"

        for attempt in range(self.MAX_RETRIES):
            try:
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.3,
                    timeout=120,
                )
                raw = response.choices[0].message.content
                data = json.loads(raw)
                shots = data.get("shots", [])
                if not shots:
                    raise ValueError("Kimi returned empty shots array")

                # Inject shot_id server-side (do not trust LLM-generated IDs)
                for i, shot in enumerate(shots):
                    shot["shot_id"] = f"{episode}_{i + 1:03d}"

                data["shots"] = shots
                return data

            except (json.JSONDecodeError, ValueError) as exc:
                logger.warning(f"Attempt {attempt + 1}: parse error — {exc}")
                if attempt == self.MAX_RETRIES - 1:
                    raise
                await asyncio.sleep(2 ** attempt)

            except Exception as exc:
                logger.warning(f"Attempt {attempt + 1}: API error — {exc}")
                if attempt == self.MAX_RETRIES - 1:
                    raise
                await asyncio.sleep(2 ** attempt)

        raise RuntimeError("Kimi API failed after all retries")
