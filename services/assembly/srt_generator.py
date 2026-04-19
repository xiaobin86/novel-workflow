def generate_srt(shots: list[dict], shot_durations: list[float]) -> str:
    lines = []
    current_time = 0.0

    for i, (shot, dur) in enumerate(zip(shots, shot_durations)):
        start = _seconds_to_srt(current_time)
        end = _seconds_to_srt(current_time + dur)

        text = shot.get("action", "").strip()
        if shot.get("dialogue"):
            text += f"\n「{shot['dialogue'].strip()}」"

        if text:
            lines.append(f"{i + 1}\n{start} --> {end}\n{text}\n")
        current_time += dur

    return "\n".join(lines)


def _seconds_to_srt(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
