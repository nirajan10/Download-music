"""
HarmonySync Celery tasks.

Pipeline for each song:
  1. yt-dlp  → raw MP3 with SponsorBlock segments removed
  2. Rename  → cleaned YouTube title, moved to output directory
  3. Metadata → yt-dlp music fields if available (official uploads),
               otherwise iTunes text search (when auto_metadata=True)
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
from metadata import (
    auto_tag, write_tags,
    search_itunes, search_spotify,
    fetch_cover_art, save_cover_to_disk,
    _relevance_score,
)

DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

COOKIES_FILE = Path(os.getenv("COOKIES_FILE", "/cookies/cookies.txt"))

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _safe_name(s: str) -> str:
    """Strip filesystem-unsafe characters from a filename component."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip(". ")


_SONG_COLUMNS = {c.key for c in Song.__table__.columns}


def _set_status(song_id: int, **kwargs) -> None:
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if song:
            for key, val in kwargs.items():
                if key in _SONG_COLUMNS:
                    setattr(song, key, val)
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                print(f"[_set_status] DB commit failed for song {song_id}: {e}")
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

def _ytdlp_metadata(info: dict) -> dict | None:
    """
    Extract clean music metadata from a yt-dlp info dict.
    Returns a dict when the 'track' field is present (YouTube Music / official
    music video uploads). Returns None for regular videos.
    """
    track = (info.get("track") or "").strip()
    if not track:
        return None
    artist = (info.get("artist") or "").strip() or None
    album = (info.get("album") or "").strip() or None
    year: str | None = None
    if info.get("release_year"):
        year = str(info["release_year"])
    elif info.get("release_date"):
        year = str(info["release_date"])[:4]
    return {"title": track, "artist": artist, "album": album, "year": year}


def _stage_download(source_url: str, youtube_id: str, tmp: Path, progress_hook=None, quality: int = 320) -> tuple[Path, str, dict]:
    """
    Download audio via yt-dlp.
    Returns (mp3_path, raw_title, info).
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
                "preferredquality": str(quality),
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

    return candidates[0], raw_title, info


# ──────────────────────────────────────────────────────────────────────────────
# Celery task
# ──────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, name="tasks.download_song", max_retries=2)
def download_song(self, song_id: int, auto_metadata: bool = False, auto_metadata_source: str = "itunes", quality: int = 320) -> dict:
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
            raw_mp3, raw_title, yt_info = _stage_download(source_url, youtube_id, tmp, progress_hook=hook, quality=quality)
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

        metadata_source = "youtube"
        extra_fields: dict = {}

        yt_meta = _ytdlp_metadata(yt_info)

        if yt_meta:
            # Official YouTube Music upload — metadata embedded by YouTube itself.
            # Always apply text tags; fetch cover art only when auto_metadata is on.
            if auto_metadata:
                _set_status(song_id, status="tagging", progress=85)
            try:
                cover_bytes = None
                cover_path = None
                if auto_metadata:
                    query = " ".join(filter(None, [yt_meta.get("artist"), yt_meta["title"]]))
                    candidates = search_itunes(query)
                    if candidates:
                        cover_bytes = fetch_cover_art(candidates[0].get("cover_url", ""))
                        if cover_bytes:
                            cover_path = save_cover_to_disk(cover_bytes, song_id, DOWNLOAD_DIR)
                write_tags(
                    str(final_path),
                    title=yt_meta["title"],
                    artist=yt_meta.get("artist"),
                    album=yt_meta.get("album"),
                    year=yt_meta.get("year"),
                    cover_bytes=cover_bytes,
                )
                metadata_source = "ytmusic"
                extra_fields = {
                    "title": yt_meta["title"],
                    "artist": yt_meta.get("artist"),
                    "album": yt_meta.get("album"),
                    "cover_path": cover_path,
                }
                if yt_meta.get("year"):
                    extra_fields["year"] = int(yt_meta["year"])
            except Exception as exc:
                print(f"[yt-meta] failed for {song_id}: {exc}")

        elif auto_metadata:
            # No YouTube Music fields — fall back to iTunes / Spotify text search.
            _set_status(song_id, status="tagging", progress=85)
            try:
                result = auto_tag(str(final_path), raw_title, song_id, DOWNLOAD_DIR, source=auto_metadata_source)
                if result:
                    metadata_source = auto_metadata_source
                    extra_fields = {
                        "title": result["title"],
                        "artist": result.get("artist"),
                        "album": result.get("album"),
                        "genre": result.get("genre"),
                        "spotify_id": result.get("spotify_id"),
                        "itunes_id": result.get("itunes_id"),
                        "cover_path": result.get("cover_path"),
                    }
                    if result.get("year"):
                        extra_fields["year"] = int(result["year"])
            except Exception as exc:
                print(f"[auto-tag] failed for {song_id}: {exc}")

        _set_status(
            song_id,
            status="done",
            progress=100,
            file_path=str(final_path),
            title=extra_fields.get("title", _safe_name(raw_title)),
            artist=extra_fields.get("artist"),
            album=extra_fields.get("album"),
            genre=extra_fields.get("genre"),
            year=extra_fields.get("year"),
            spotify_id=extra_fields.get("spotify_id"),
            itunes_id=extra_fields.get("itunes_id"),
            cover_path=extra_fields.get("cover_path"),
            bitrate=quality,
            metadata_source=metadata_source,
            error_message=None,
        )
        _update_session_count(session_id)

        return {"status": "done", "file": str(final_path)}


# ──────────────────────────────────────────────────────────────────────────────
# Bulk tag task (post-download re-tagging)
# ──────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, name="tasks.tag_song", max_retries=1)
def tag_song(self, song_id: int, source: str = "itunes") -> dict:
    """
    Search iTunes or Spotify for a song that has already been downloaded
    and overwrite its ID3 tags + DB metadata with the best match.
    Uses the song's current title/artist as the search query.
    """
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            return {"error": "song not found"}
        if not song.file_path or not os.path.isfile(song.file_path):
            return {"error": "file not found"}
        title = song.title or Path(song.file_path).stem
        artist = song.artist or ""
        file_path = song.file_path
        song.status = "tagging"
        song.progress = 50
        db.commit()
    finally:
        db.close()

    try:
        if source == "spotify":
            candidates = search_spotify(title, artist)
        else:
            candidates = search_itunes(title, artist)

        if not candidates:
            _set_status(song_id, status="done", progress=100)
            return {"status": "no_match"}

        candidates = sorted(
            candidates,
            key=lambda c: _relevance_score(c, title, artist),
            reverse=True,
        )
        best = candidates[0]

        cover_bytes = fetch_cover_art(best.get("cover_url", ""))
        cover_path = None
        if cover_bytes:
            cover_path = save_cover_to_disk(cover_bytes, song_id, DOWNLOAD_DIR)

        write_tags(
            file_path,
            title=best["title"],
            artist=best.get("artist"),
            album=best.get("album"),
            year=best.get("year"),
            genre=best.get("genre"),
            cover_bytes=cover_bytes,
        )

        fields: dict = {
            "status": "done",
            "progress": 100,
            "title": best["title"],
            "artist": best.get("artist"),
            "album": best.get("album"),
            "genre": best.get("genre"),
            "cover_path": cover_path,
            "metadata_source": source,
        }
        if best.get("year"):
            fields["year"] = int(best["year"])
        if source == "spotify":
            fields["spotify_id"] = best.get("spotify_id")
        else:
            fields["itunes_id"] = best.get("itunes_id")

        _set_status(song_id, **fields)
        return {"status": "done", "title": best["title"]}

    except Exception as exc:
        print(f"[tag_song] failed for {song_id}: {exc}")
        _set_status(song_id, status="done", progress=100)
        return {"error": str(exc)}
