from abc import ABC, abstractmethod


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str, voice: str, output_path: str) -> float:
        """
        Synthesize text to WAV at output_path.
        Returns actual audio duration in seconds.
        """
        ...

    @property
    @abstractmethod
    def default_action_voice(self) -> str: ...

    @property
    @abstractmethod
    def default_dialogue_voice(self) -> str: ...
