import asyncio
import json
import logging
import os
import random
import time

import httpx

from .base import StoryboardProvider

logger = logging.getLogger(__name__)

KIMI_BASE_URL = os.getenv("KIMI_API_BASE", "https://api.kimi.com/coding/v1")
KIMI_MODEL = os.getenv("KIMI_MODEL", "kimi-k2.5")

SYSTEM_PROMPT = r"""你是漫剧导演，请将小说章节改编为标准分镜JSON。

【输出要求】
- 直接输出JSON，不要markdown代码块，不要任何说明文字
- 每个shot包含：shot_id(字符串，如"E01_001")、duration(秒)、shot_type、camera_move、scene、characters(角色id数组)、action、emotion、dialogue、image_prompt(英文)、video_prompt(英文)
- 在顶部包含 project(title, episode, total_shots, total_duration) 和 characters(id, name, gender, appearance) 数组
- shot_type可选：wide, medium, close-up, extreme-close-up, over_shoulder
- camera_move可选：static, pan, zoom-in, dolly, tracking

【image_prompt规范】英文，包含：景别、角色外貌、动作表情、场景、光影、画风(manhua style, 2.5D)

【分镜拆分规则】场景/地点变化、时间跳转、人物变化、关键道具出现、情绪转折、动作开始结束、对话主体转换、景别变化时，都新建镜头。"""


class KimiProvider(StoryboardProvider):
    MAX_RETRIES = 3
    BACKOFF_BASE = 2

    def __init__(self):
        self._api_key = os.getenv("KIMI_API_KEY", "")

    def _build_headers(self) -> dict:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _build_prompt(self, text: str, episode: str, title: str) -> str:
        ep_num = int("".join(filter(str.isdigit, episode)) or "1")
        prefix = f"E{ep_num:02d}"
        return (
            f"{SYSTEM_PROMPT}\n\n"
            f"请将以下小说章节改编为漫剧分镜脚本。\n"
            f"作品标题：{title}\n"
            f"集数：第 {ep_num} 集\n"
            f"镜号前缀请使用 {prefix}_ 格式（如 {prefix}_001）。\n\n"
            f"小说内容：\n{text}"
        )

    async def generate(self, text: str, episode: str, title: str, config: dict) -> list[dict]:
        prompt = self._build_prompt(text, episode, title)
        url = f"{KIMI_BASE_URL}/messages"
        payload = {
            "model": KIMI_MODEL,
            "max_tokens": config.get("max_tokens", 8192),
            "messages": [{"role": "user", "content": prompt}],
        }

        last_exc: Exception | None = None
        async with httpx.AsyncClient(timeout=300) as client:
            for attempt in range(1, self.MAX_RETRIES + 1):
                logger.info("Calling Kimi Code API (attempt %d/%d)", attempt, self.MAX_RETRIES)
                try:
                    resp = await client.post(url, headers=self._build_headers(), json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    # Anthropic Messages API: content is a list of blocks; concatenate all text blocks
                    raw_text = ""
                    for block in data.get("content", []):
                        if isinstance(block, dict) and block.get("type") == "text":
                            raw_text += block.get("text", "")
                        elif isinstance(block, str):
                            raw_text += block
                    raw_text = raw_text.strip()
                except httpx.HTTPStatusError as exc:
                    last_exc = exc
                    logger.warning("Kimi API HTTP error %s: %s", exc.response.status_code, exc.response.text)
                    if exc.response.status_code in (401, 403):
                        raise RuntimeError(f"Kimi authentication failed: {exc.response.text}") from exc
                    wait = self.BACKOFF_BASE ** attempt + random.uniform(0, 1)
                    await asyncio.sleep(wait)
                    continue
                except Exception as exc:
                    last_exc = exc
                    logger.warning("Kimi API error: %s", exc)
                    wait = self.BACKOFF_BASE ** attempt + random.uniform(0, 1)
                    await asyncio.sleep(wait)
                    continue

                storyboard = self._extract_json(raw_text)
                if storyboard is None:
                    logger.error("JSON parse failed. Raw response[:1000]: %s", raw_text[:1000])
                    raise RuntimeError("Kimi returned content that cannot be parsed as JSON")

                shots = storyboard.get("shots", [])
                if not shots:
                    raise ValueError("Kimi returned empty shots array")

                # Normalize shot_ids server-side
                for i, shot in enumerate(shots):
                    shot["shot_id"] = f"{episode}_{i + 1:03d}"

                storyboard["shots"] = shots
                return storyboard

        raise RuntimeError(f"Kimi API failed after {self.MAX_RETRIES} attempts. Last error: {last_exc}")

    @staticmethod
    def _extract_json(raw_text: str) -> dict | None:
        import re

        # 1. Try direct parse
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as e:
            logger.debug("Direct JSON parse failed: %s", e)

        # 2. Strip markdown code blocks
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.debug("Markdown-stripped JSON parse failed: %s", e)

        # 3. Extract outermost JSON object (handle text before/after JSON)
        # Find the first { and match braces
        start = cleaned.find("{")
        if start == -1:
            return None

        brace_count = 0
        end = start
        for i, ch in enumerate(cleaned[start:], start):
            if ch == "{":
                brace_count += 1
            elif ch == "}":
                brace_count -= 1
                if brace_count == 0:
                    end = i + 1
                    break

        if brace_count == 0 and end > start:
            try:
                return json.loads(cleaned[start:end])
            except json.JSONDecodeError as e:
                logger.debug("Brace-matched JSON parse failed: %s", e)

        # 4. Fallback: regex search for any JSON object
        match = re.search(r"(\{[\s\S]*\})", cleaned)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError as e:
                logger.debug("Regex JSON parse failed: %s", e)

        return None
