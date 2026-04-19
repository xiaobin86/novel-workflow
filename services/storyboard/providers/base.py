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
        Convert novel text into a list of Shot dicts.
        Each dict must conform to the Shot schema in 00-data-model.md.
        """
        ...
