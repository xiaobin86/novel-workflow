import asyncio
from datetime import datetime, timezone

from .base import StoryboardProvider


class MockStoryboardProvider(StoryboardProvider):
    async def generate(self, text: str, episode: str, title: str, config: dict) -> list[dict]:
        await asyncio.sleep(1)  # simulate latency
        shots = []
        for i in range(3):
            shots.append({
                "shot_id": f"{episode}_{i + 1:03d}",
                "shot_type": "medium",
                "camera_move": "static",
                "scene": f"Mock scene {i + 1}",
                "characters": ["主角"],
                "emotion": "calm",
                "action": f"第 {i + 1} 个镜头的旁白文本。",
                "dialogue": "这是台词。" if i == 1 else None,
                "image_prompt": "Anime Chinese manhua style, cel-shaded. Mock scene.",
                "video_prompt": "Static shot. Mock motion.",
                "duration": 4.0,
            })
        return {
            "project": {
                "title": title or "Mock Title",
                "episode": episode,
                "total_shots": len(shots),
                "total_duration": len(shots) * 4,
                "source_novel": "用户自供",
            },
            "characters": [{"id": "hero", "name": "主角", "gender": "男", "appearance": "Mock appearance."}],
            "shots": shots,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
