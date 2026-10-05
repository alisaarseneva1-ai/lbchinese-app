"""Озвучка мини-приложения (запускается на GitHub, см. .github/workflows/audio.yml).

Читает audio_clips.json и создаёт недостающие файлы audio/<id>.mp3 нейроголосами Microsoft Edge:
  w — голос учителя (Сяосяо) для слов, примеров и фраз: медленнее обычного, чтобы тоны было хорошо слышно;
  m / f — мужской и женский голос в диалогах (реплики 男 / 女); n — диктор экзамена.
Работает в несколько потоков и каждые ~1500 файлов сохраняет готовое в репозиторий —
если GitHub прервёт долгий запуск, следующий запуск продолжит с того же места.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile

import edge_tts

VOICE = {"w": "zh-CN-XiaoxiaoNeural", "m": "zh-CN-YunxiNeural", "f": "zh-CN-XiaoxiaoNeural", "n": "zh-CN-YunyangNeural"}
SPEAKER = {"男": "m", "女": "f", "": "n", "w": "w"}
HAN = re.compile(r"[㐀-鿿]")
WORKERS = int(os.getenv("AUDIO_WORKERS", "6"))
BATCH = 1500


def rate_for(code: str, text: str) -> str:
    if code != "w":
        return "-10%"                       # экзамен: почти обычная скорость, как на настоящем HSK
    n = len(HAN.findall(text))
    return "-30%" if n <= 2 else "-22%" if n <= 6 else "-15%" if n <= 40 else "-8%"


async def synth(text: str, code: str, path: str):
    for attempt in range(5):
        try:
            await edge_tts.Communicate(text, VOICE[code], rate=rate_for(code, text)).save(path)
            if os.path.getsize(path) > 0:
                return
        except Exception as exc:
            print("  повтор:", type(exc).__name__, text[:20], flush=True)
        await asyncio.sleep(3 * (attempt + 1))
    raise RuntimeError(f"не удалось озвучить: {text[:30]}")


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


async def make(cid: str, lines: list, tmp: str):
    parts = []
    for i, (who, text) in enumerate(lines):
        p = f"{tmp}/{cid}_{i}.mp3"
        await synth(text, SPEAKER.get(who, "n"), p)
        parts.append(p)
    out = f"audio/{cid}.mp3"
    if len(parts) == 1:
        # 32 кбит/с моно — для речи звучит так же, а файлы на треть меньше
        await asyncio.to_thread(ffmpeg, "-i", parts[0], "-ac", "1", "-ar", "24000", "-b:a", "32k", out)
    else:   # реплики диалога склеиваем с паузой 0,6 с
        lst = f"{tmp}/{cid}.txt"
        with open(lst, "w") as f:
            for j, p in enumerate(parts):
                f.write(f"file '{p}'\n")
                if j < len(parts) - 1:
                    f.write(f"file '{tmp}/pause.mp3'\n")
        await asyncio.to_thread(ffmpeg, "-f", "concat", "-safe", "0", "-i", lst, "-ac", "1", "-ar", "24000", "-b:a", "40k", out)
    for p in parts:
        os.remove(p)


def save(n: int):
    """Сохраняет готовые mp3 в репозиторий (только на GitHub)."""
    if not os.getenv("GITHUB_ACTIONS"):
        return
    subprocess.run(["git", "add", "audio"], check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode:
        subprocess.run(["git", "commit", "-q", "-m", f"Озвучка: ещё {n} файлов"], check=True)
        for _ in range(3):
            if subprocess.run(["git", "push", "-q"]).returncode == 0:
                return
            subprocess.run(["git", "pull", "-q", "--rebase"])
        sys.exit("не удалось сохранить озвучку")


async def main():
    clips = json.load(open("audio_clips.json", encoding="utf-8"))
    os.makedirs("audio", exist_ok=True)
    todo = [(cid, lines) for cid, lines in clips.items() if not os.path.exists(f"audio/{cid}.mp3")]
    print(f"Всего фраз: {len(clips)}, нужно озвучить: {len(todo)}", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.6", "-q:a", "9", f"{tmp}/pause.mp3")
        sem = asyncio.Semaphore(WORKERS)
        failed = []

        async def one(cid, lines):
            async with sem:
                try:
                    await make(cid, lines, tmp)
                except Exception as exc:
                    failed.append(cid)
                    print("✗", cid, exc, flush=True)

        for start in range(0, len(todo), BATCH):
            chunk = todo[start:start + BATCH]
            await asyncio.gather(*(one(cid, lines) for cid, lines in chunk))
            done = min(start + BATCH, len(todo))
            print(f"Готово {done} из {len(todo)}", flush=True)
            save(len(chunk))
        if failed:
            print(f"Не получилось: {len(failed)} — запустите озвучку ещё раз (Actions → Run workflow)", flush=True)


asyncio.run(main())
