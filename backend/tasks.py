"""
HarmonySync Celery tasks.

Pipeline for each song:
  1. yt-dlp  → raw 320kbps MP3 with SponsorBlock segments removed
  2. Rename  → cleaned YouTube title, moved to output directory
"""

import os
import re
import shutil
import tempfile
import time
from pathlib import Path

import yt_dlp

from celery_app import celery
from database import SessionLocal
from models import DownloadSession, Song

DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

COOKIES_FILE = Path(os.getenv("COOKIES_FILE", "/cookies/cookies.txt"))

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _safe_name(s: str) -> str:
    """Strip filesystem-unsafe characters from a filename component."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip(". ")


def _set_status(song_id: int, **kwargs) -> None:
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if song:
            for key, val in kwargs.items():
                setattr(song, key, val)
            db.commit()
    finally:
        db.close()


def _update_session_count(session_id: int) -> None:
    db = SessionLocal()
    try:
        done = (
            db.query(Song)
            .filter(Song.session_id == session_id, Song.status == "done")
            .count()
        )
        s = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
        if s:
            s.total_songs = done
            db.commit()
    finally:
        db.close()


def _make_progress_hook(song_id: int):
    last_write = [0.0]

    def _hook(d: dict) -> None:
        if d["status"] != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        if total <= 0:
            return
        pct = int(d.get("downloaded_bytes", 0) / total * 100)
        now = time.monotonic()
        if now - last_write[0] >= 1.0:
            last_write[0] = now
            _set_status(song_id, progress=pct)

    return _hook


# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — yt-dlp download
# ──────────────────────────────────────────────────────────────────────────────

def _stage_download(source_url: str, youtube_id: str, tmp: Path, progress_hook=None) -> tuple[Path, str]:
    """
    Download audio via yt-dlp.
    Returns (mp3_path, raw_title).
    Raises RuntimeError on failure.
    """
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(tmp / "%(id)s.%(ext)s"),
        "extractor_args": {"youtube": {"player_client": ["web", "ios", "android"]}},
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "320",
            }
        ],
        "sponsorblock_remove": [
            "intro",
            "outro",
            "selfpromo",
            "interaction",
            "music_offtopic",
        ],
        "js_runtimes": {"node": {}},
        "remote_components": {"ejs:github"},
        "nocheckcertificate": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        "progress_hooks": [progress_hook] if progress_hook else [],
    }
    if COOKIES_FILE.is_file() and COOKIES_FILE.stat().st_size > 0:
        ydl_opts["cookiefile"] = str(COOKIES_FILE)

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(source_url, download=True)

    raw_title: str = info.get("title", youtube_id)

    candidates = list(tmp.glob(f"{youtube_id}*.mp3"))
    if not candidates:
        raise RuntimeError(f"MP3 not produced by yt-dlp for {youtube_id}")

    return candidates[0], raw_title


# ──────────────────────────────────────────────────────────────────────────────
# Celery task
# ──────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, name="tasks.download_song", max_retries=2)
def download_song(self, song_id: int) -> dict:
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            return {"error": "song not found"}
        if song.status == "cancelled":
            return {"error": "cancelled"}
        session_id = song.session_id
        youtube_id = song.youtube_id
        source_url = song.source_url or f"https://www.youtube.com/watch?v={youtube_id}"
        session = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
        folder_name = session.folder_name if session else None
        song.task_id = self.request.id
        db.commit()
    finally:
        db.close()

    with tempfile.TemporaryDirectory() as _tmp:
        tmp = Path(_tmp)

        _set_status(song_id, status="downloading", progress=0, error_message=None)
        try:
            hook = _make_progress_hook(song_id)
            raw_mp3, raw_title = _stage_download(source_url, youtube_id, tmp, progress_hook=hook)
        except Exception as exc:
            _set_status(song_id, status="failed", error_message=str(exc)[:500])
            return {"error": str(exc)}

        # Bail out if cancelled while downloading
        _check = SessionLocal()
        try:
            _s = _check.query(Song).filter(Song.id == song_id).first()
            if _s and _s.status == "cancelled":
                return {"error": "cancelled"}
        finally:
            _check.close()

        filename = f"{_safe_name(raw_title)}.mp3"
        output_dir = DOWNLOAD_DIR / folder_name if folder_name else DOWNLOAD_DIR
        output_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(output_dir, 0o755)
        final_path = output_dir / filename

        shutil.move(str(raw_mp3), str(final_path))
        os.chmod(final_path, 0o644)

        _set_status(
            song_id,
            status="done",
            progress=100,
            file_path=str(final_path),
            title=_safe_name(raw_title),
            bitrate=320,
            metadata_source="youtube",
            error_message=None,
        )
        _update_session_count(session_id)

        return {"status": "done", "file": str(final_path)}
