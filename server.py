"""room tone — house line.

yt-dlp is the extractor. Search, metadata, playlist import, and a
range-aware audio proxy all go through it. Video ids are validated
before they ever reach a process argument.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("roomtone")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
YTDLP = os.environ.get("YTDLP_BIN") or str(ROOT / ".venv" / "bin" / "yt-dlp")
if not Path(YTDLP).exists():
    YTDLP = "yt-dlp"

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{12,64}$")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

SEARCH_CACHE: dict[str, tuple[float, list]] = {}
STREAMS: dict[str, dict] = {}
HEALTH = {"ok": False, "detail": "starting", "checked": 0.0}
YTDLP_VERSION = ""
SEM = asyncio.Semaphore(2)
http: httpx.AsyncClient | None = None


def _youtube_id_from_url(value: str) -> str | None:
    value = (value or "").strip()
    if VIDEO_ID.match(value):
        return value
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in {"youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"}:
        return None
    if host == "youtu.be":
        part = parsed.path.strip("/").split("/")[0]
        return part if VIDEO_ID.match(part) else None
    if parsed.path.startswith("/shorts/") or parsed.path.startswith("/embed/"):
        part = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else ""
        return part if VIDEO_ID.match(part) else None
    from urllib.parse import parse_qs

    q = parse_qs(parsed.query)
    vid = (q.get("v") or [""])[0]
    return vid if VIDEO_ID.match(vid) else None


def _playlist_id_from_url(value: str) -> str | None:
    from urllib.parse import parse_qs

    value = (value or "").strip()
    if value.startswith("PL") and PLAYLIST_ID.match(value):
        return value
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host not in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        return None
    pid = (parse_qs(parsed.query).get("list") or [""])[0]
    return pid if PLAYLIST_ID.match(pid) else None


def to_track(entry: dict | None) -> dict | None:
    if not entry or not isinstance(entry, dict):
        return None
    if entry.get("_type") in {"playlist", "url"} and not entry.get("title") and entry.get("entries"):
        return None
    vid = entry.get("id") or ""
    if not VIDEO_ID.match(str(vid)):
        # flat playlist sometimes returns the id in url
        url = entry.get("url") or entry.get("webpage_url") or ""
        vid = _youtube_id_from_url(url) or ""
    if not VIDEO_ID.match(str(vid)):
        return None
    if entry.get("is_live") or entry.get("live_status") in {"is_live", "is_upcoming"}:
        return None
    title = (entry.get("title") or "").strip()
    if not title or title in {"[Private video]", "[Deleted video]"}:
        return None
    artist = (entry.get("channel") or entry.get("uploader") or entry.get("artist") or "Unknown").strip()
    duration = entry.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        duration = int(duration)
    else:
        duration = None
    return {
        "id": vid,
        "title": title,
        "artist": artist,
        "duration": duration,
        "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
    }


def parse_entries(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8", "replace").strip()
    if not text:
        return []
    blobs: list[dict] = []
    if text.startswith("{") and "\n{" not in text:
        try:
            blobs.append(json.loads(text))
        except json.JSONDecodeError:
            return []
    else:
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                blobs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    tracks: list[dict] = []
    seen: set[str] = set()

    def take(entry: dict | None) -> None:
        if entry and entry.get("entries"):
            for sub in entry["entries"] or []:
                take(sub)
            return
        track = to_track(entry)
        if track and track["id"] not in seen:
            seen.add(track["id"])
            tracks.append(track)

    for blob in blobs:
        take(blob)
    return tracks


async def run_ytdlp(args: list[str], timeout: float = 28) -> tuple[int, bytes, str]:
    async with SEM:
        try:
            proc = await asyncio.create_subprocess_exec(
                YTDLP,
                "--no-warnings",
                "--ignore-errors",
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            return 127, b"", "yt-dlp not installed"
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return 124, b"", "timeout"
        err = stderr.decode("utf-8", "replace")[-400:]
        return proc.returncode or 0, stdout, err


async def probe() -> dict:
    global YTDLP_VERSION
    code, out, err = await run_ytdlp(
        ["--flat-playlist", "--dump-single-json", "--playlist-end", "1", "ytsearch1:room tone"],
        timeout=14,
    )
    ok = code == 0 and b'"id"' in out
    if not YTDLP_VERSION:
        vcode, vout, _ = await run_ytdlp(["--version"], timeout=8)
        if vcode == 0:
            YTDLP_VERSION = vout.decode().strip().splitlines()[-1] if vout else ""
    return {"ok": ok, "detail": "up" if ok else (err or "unreachable"), "checked": time.time()}


async def health_loop() -> None:
    global HEALTH
    while True:
        try:
            HEALTH = await probe()
            log.info("house line %s", "up" if HEALTH["ok"] else "quiet")
        except Exception as exc:  # noqa: BLE001
            HEALTH = {"ok": False, "detail": str(exc), "checked": time.time()}
        await asyncio.sleep(90 if HEALTH.get("ok") else 40)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global http
    http = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(20.0, connect=10.0),
        headers={"User-Agent": UA},
    )
    task = asyncio.create_task(health_loop())
    yield
    task.cancel()
    await http.aclose()


app = FastAPI(title="room tone", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "ytdlp": bool(HEALTH.get("ok")),
        "detail": "up" if HEALTH.get("ok") else "quiet",
        "version": YTDLP_VERSION,
    }


@app.get("/api/search")
async def search(q: str = Query("", max_length=180), limit: int = Query(16, ge=1, le=24)):
    q = q.strip()
    if len(q) < 1:
        raise HTTPException(400, "empty query")
    if not HEALTH.get("ok"):
        return JSONResponse({"ok": False, "tracks": [], "reason": "house-line-quiet"}, status_code=503)
    key = f"{q.lower()}::{limit}"
    cached = SEARCH_CACHE.get(key)
    if cached and cached[0] > time.time():
        return {"ok": True, "tracks": cached[1], "source": "yt-dlp"}
    code, out, err = await run_ytdlp(
        ["--flat-playlist", "--dump-single-json", f"ytsearch{limit}:{q}"],
        timeout=32,
    )
    tracks = parse_entries(out)
    if not tracks and code != 0:
        log.warning("search failed: %s", err[:180])
        raise HTTPException(502, "search failed")
    SEARCH_CACHE[key] = (time.time() + 600, tracks)
    if len(SEARCH_CACHE) > 200:
        oldest = sorted(SEARCH_CACHE, key=lambda k: SEARCH_CACHE[k][0])[:40]
        for k in oldest:
            SEARCH_CACHE.pop(k, None)
    return {"ok": True, "tracks": tracks, "source": "yt-dlp"}


@app.get("/api/meta/{video_id}")
async def meta(video_id: str):
    if not VIDEO_ID.match(video_id):
        raise HTTPException(400, "bad id")
    if not HEALTH.get("ok"):
        raise HTTPException(503, "house line quiet")
    code, out, err = await run_ytdlp(
        ["--no-playlist", "--dump-single-json", "--skip-download", f"https://www.youtube.com/watch?v={video_id}"],
        timeout=35,
    )
    tracks = parse_entries(out)
    if not tracks:
        raise HTTPException(404, err[:180] or "unavailable")
    return tracks[0]


@app.get("/api/import")
async def import_playlist(url: str = Query("", max_length=400)):
    pid = _playlist_id_from_url(url)
    vid = _youtube_id_from_url(url)
    if not pid and not vid:
        raise HTTPException(400, "youtube playlist or video only")
    if not HEALTH.get("ok"):
        return JSONResponse({"ok": False, "tracks": [], "reason": "house-line-quiet"}, status_code=503)
    target = f"https://www.youtube.com/playlist?list={pid}" if pid else f"https://www.youtube.com/watch?v={vid}"
    args = ["--flat-playlist", "--dump-single-json", "--playlist-end", "80", target]
    # playlist import must allow playlists
    code, out, err = await run_ytdlp_playlist(args)
    tracks = parse_entries(out)
    if not tracks:
        raise HTTPException(404, err[:180] or "empty")
    title = "Imported shelf"
    try:
        blob = json.loads(out.decode("utf-8", "replace").strip().splitlines()[0])
        title = blob.get("title") or title
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "title": title, "tracks": tracks, "source": "yt-dlp"}


async def run_ytdlp_playlist(args: list[str]) -> tuple[int, bytes, str]:
    async with SEM:
        proc = await asyncio.create_subprocess_exec(
            YTDLP,
            "--no-warnings",
            "--ignore-errors",
            "--yes-playlist",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=45)
        except asyncio.TimeoutError:
            proc.kill()
            return 124, b"", "timeout"
        return proc.returncode or 0, stdout, stderr.decode("utf-8", "replace")[-400:]


async def resolve_stream(video_id: str, force: bool = False) -> dict:
    cached = STREAMS.get(video_id)
    if cached and not force and cached["exp"] > time.time():
        return cached
    url = f"https://www.youtube.com/watch?v={video_id}"
    attempts = [
        ["--no-playlist", "-f", "140/251/ba[ext=m4a]/ba", "-g", url],
        ["--no-playlist", "--extractor-args", "youtube:player_client=android", "-f", "140/251/ba", "-g", url],
        ["--no-playlist", "--extractor-args", "youtube:player_client=ios", "-f", "ba[ext=m4a]/ba", "-g", url],
    ]
    last = "no stream"
    for args in attempts:
        code, out, err = await run_ytdlp(args, timeout=30)
        line = next((ln.strip() for ln in out.decode("utf-8", "replace").splitlines() if ln.strip().startswith("http")), "")
        if code == 0 and line:
            mime = "audio/webm" if "audio%2Fwebm" in line or "mime=audio/webm" in line else "audio/mp4"
            rec = {"url": line, "mime": mime, "exp": time.time() + 2.5 * 3600}
            STREAMS[video_id] = rec
            if len(STREAMS) > 80:
                oldest = sorted(STREAMS, key=lambda k: STREAMS[k]["exp"])[:20]
                for k in oldest:
                    STREAMS.pop(k, None)
            return rec
        last = err or last
    raise HTTPException(502, last[:180])


@app.api_route("/api/stream/{video_id}", methods=["GET", "HEAD"])
async def stream(video_id: str, request: Request):
    if not VIDEO_ID.match(video_id):
        raise HTTPException(400, "bad id")
    if http is None:
        raise HTTPException(503, "not ready")
    rec = await resolve_stream(video_id)
    upstream = await _open_upstream(rec["url"], request)
    if upstream.status_code in {403, 410}:
        await upstream.aclose()
        rec = await resolve_stream(video_id, force=True)
        upstream = await _open_upstream(rec["url"], request)
    ctype = upstream.headers.get("content-type", rec["mime"])
    if upstream.status_code >= 400 or "text/html" in ctype:
        await upstream.aclose()
        STREAMS.pop(video_id, None)
        raise HTTPException(502, "upstream refused")
    headers = {
        "Content-Type": ctype.split(";")[0] or rec["mime"],
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=600",
    }
    if cl := upstream.headers.get("content-length"):
        headers["Content-Length"] = cl
    if cr := upstream.headers.get("content-range"):
        headers["Content-Range"] = cr

    async def body():
        try:
            async for chunk in upstream.aiter_bytes(64 * 1024):
                yield chunk
        finally:
            await upstream.aclose()

    if request.method == "HEAD":
        await upstream.aclose()
        return StreamingResponse(iter(()), status_code=upstream.status_code, headers=headers)
    return StreamingResponse(body(), status_code=upstream.status_code, headers=headers)


async def _open_upstream(url: str, request: Request) -> httpx.Response:
    headers = {
        "User-Agent": UA,
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
        "Accept": "*/*",
    }
    if rng := request.headers.get("range"):
        headers["Range"] = rng
    req = http.build_request("GET", url, headers=headers)
    return await http.send(req, stream=True, timeout=httpx.Timeout(None, connect=12.0))


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/assets", StaticFiles(directory=STATIC), name="assets")
# Same files, relative to index.html, so a static mirror can open the room
# without a leading /assets prefix. Registered after the API routes.
app.mount("/", StaticFiles(directory=STATIC, html=False), name="root-static")
