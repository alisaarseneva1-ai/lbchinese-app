"""Озвучка экзаменов для мини-приложения (запускается на GitHub, см. .github/workflows/audio.yml).

Читает audio_clips.json и создаёт недостающие файлы audio/<id>.mp3 голосами Microsoft Edge:
мужской голос — реплики 男, женский — реплики 女, диктор — остальное.
"""
import asyncio
import json
import os
import subprocess
import tempfile

import edge_tts

VOICE = {"m": "zh-CN-YunxiNeural", "f": "zh-CN-XiaoxiaoNeural", "n": "zh-CN-YunyangNeural"}
SPEAKER = {"男": "m", "女": "f", "": "n"}


async def synth(text: str, voice: str, path: str):
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate="-10%").save(path)
            return
        except Exception:
            await asyncio.sleep(3 * (attempt + 1))
    raise RuntimeError(f"не удалось озвучить: {text[:30]}")


async def main():
    clips = json.load(open("audio_clips.json", encoding="utf-8"))
    os.makedirs("audio", exist_ok=True)
    todo = {cid: lines for cid, lines in clips.items() if not os.path.exists(f"audio/{cid}.mp3")}
    print(f"Всего фраз: {len(clips)}, нужно озвучить: {len(todo)}")
    for cid, lines in todo.items():
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for i, (who, text) in enumerate(lines):
                p = f"{tmp}/{i}.mp3"
                await synth(text, VOICE[SPEAKER.get(who, "n")], p)
                parts.append(p)
            if len(parts) == 1:
                os.replace(parts[0], f"audio/{cid}.mp3")
            else:   # реплики диалога склеиваем с паузой 0,6 с
                lst = f"{tmp}/list.txt"
                subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                                "-t", "0.6", "-q:a", "9", f"{tmp}/pause.mp3"], check=True)
                with open(lst, "w") as f:
                    for j, p in enumerate(parts):
                        f.write(f"file '{p}'\n")
                        if j < len(parts) - 1:
                            f.write(f"file '{tmp}/pause.mp3'\n")
                subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                                "-ac", "1", "-ar", "24000", "-b:a", "48k", f"audio/{cid}.mp3"], check=True)
        print("✓", cid)


asyncio.run(main())
