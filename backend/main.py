import hashlib
import re
import os
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import yt_dlp
from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session as DBSession

from database import Base, engine, get_db
from models import DownloadSession, Song
from schemas import DownloadRequest, PlaylistCheckResponse, SessionOut
from tasks import download_song

Base.metadata.create_all(bind=engine)

# Migrate: add columns introduced after initial schema
with engine.connect() as _conn:
    for stmt in [
        "ALTER TABLE songs ADD COLUMN progress INTEGER DEFAULT 0",
        "ALTER TABLE songs ADD COLUMN task_id VARCHAR",
        "ALTER TABLE sessions ADD COLUMN folder_name VARCHAR",
    ]:
        try:
            _conn.execute(text(stmt))
            _conn.commit()
        except Exception:
            _conn.rollback()  # must rollback before the next statement

# Migrate: remove UNIQUE constraints from sessions.url and sessions.url_hash.
# SQLAlchemy stores unique=True as a separate UNIQUE INDEX in sqlite_master,
# not inline in the CREATE TABLE statement, so we check for those indexes.
with engine.connect() as _conn:
    try:
        has_unique_idx = _conn.execute(text(
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type='index' AND tbl_name='sessions' "
            "AND sql IS NOT NULL AND upper(sql) LIKE '%UNIQUE%'"
        )).scalar() or 0
        if has_unique_idx > 0:
            _conn.execute(text("""
                CREATE TABLE IF NOT EXISTS sessions_new (
                    id             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    url            VARCHAR NOT NULL,
                    url_hash       VARCHAR(16) NOT NULL,
                    playlist_id    VARCHAR,
                    last_synced_at DATETIME,
                    total_songs    INTEGER DEFAULT 0,
                    folder_name    VARCHAR
                )
            """))
            _conn.execute(text(
                "INSERT INTO sessions_new "
                "SELECT id, url, url_hash, playlist_id, last_synced_at, "
                "       total_songs, folder_name FROM sessions"
            ))
            _conn.execute(text("DROP TABLE sessions"))
            _conn.execute(text("ALTER TABLE sessions_new RENAME TO sessions"))
            _conn.commit()
    except Exception:
        _conn.rollback()

app = FastAPI(title="HarmonySync API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────

def _url_hash(url: str) -> str:
    """Unique per-run hash: URL + current timestamp ensures no two sessions collide."""
    key = f"{url.strip()}-{time.time_ns()}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _extract_playlist_id(url: str) -> str | None:
    m = re.search(r"[?&]list=([A-Za-z0-9_-]+)", url)
    return m.group(1) if m else None


_COOKIES_FILE = os.getenv("COOKIES_FILE", "/cookies/cookies.txt")


def _file_on_disk(song: Song) -> bool:
    """True only when the song is marked done AND the file physically exists."""
    return (
        song.status == "done"
        and bool(song.file_path)
        and os.path.isfile(song.file_path)
    )


def _safe_folder(name: str) -> str:
    """Sanitize a playlist title for use as a directory name."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(". ")
    return cleaned or "playlist"


def _isolate_video_url(url: str) -> str:
    """
    Strip playlist/index params so yt-dlp only sees a single video.
    e.g. https://youtube.com/watch?v=abc&list=PL123&index=3  →  ?v=abc
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    if "v" in params:
        return urlunparse(parsed._replace(query=urlencode({"v": params["v"][0]})))
    return url


def _fetch_yt_items(url: str, single: bool = False) -> tuple[list[dict], str | None]:
    """
    Return (items, folder_name).
    folder_name is the sanitized playlist title, or None for single videos.
    """
    if single:
        url = _isolate_video_url(url)
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
    }
    if os.path.isfile(_COOKIES_FILE) and os.path.getsize(_COOKIES_FILE) > 0:
        opts["cookiefile"] = _COOKIES_FILE
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    is_playlist = info.get("_type") in ("playlist", "multi_video")
    folder_name = _safe_folder(info.get("title", "")) if (is_playlist and not single) else None

    entries = info.get("entries") or [info]
    items = [
        {
            "id": e.get("id"),
            "title": e.get("title") or e.get("id"),
            "url": e.get("url") or f"https://www.youtube.com/watch?v={e.get('id')}",
        }
        for e in entries
        if e and e.get("id")
    ]
    return items, folder_name


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/sessions", response_model=list[SessionOut])
def list_sessions(db: DBSession = Depends(get_db)):
    return (
        db.query(DownloadSession)
        .order_by(DownloadSession.last_synced_at.desc())
        .all()
    )


@app.get("/api/sessions/active")
def get_active_sessions(db: DBSession = Depends(get_db)):
    """Sessions that still have at least one in-progress song."""
    in_progress = ["pending", "downloading", "tagging"]
    subq = (
        db.query(Song.session_id)
        .filter(Song.status.in_(in_progress))
        .distinct()
        .subquery()
    )
    sessions = (
        db.query(DownloadSession)
        .filter(DownloadSession.id.in_(subq))
        .order_by(DownloadSession.last_synced_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "url": s.url,
            "in_progress": db.query(Song)
                .filter(Song.session_id == s.id, Song.status.in_(in_progress))
                .count(),
            "total": db.query(Song).filter(Song.session_id == s.id).count(),
        }
        for s in sessions
    ]


@app.get("/api/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: DBSession = Depends(get_db)):
    s = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


@app.post("/api/check", response_model=PlaylistCheckResponse)
def check_url(req: DownloadRequest, db: DBSession = Depends(get_db)):
    """
    Inspect a URL without starting any downloads.
    Returns how many songs are new vs already archived.
    Checks on-disk state across ALL past sessions — never couples to one session.
    """
    try:
        yt_items, _ = _fetch_yt_items(req.url, single=(req.mode == "single"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not fetch playlist: {exc}")

    yt_ids = {item["id"] for item in yt_items}

    # Find every youtube_id that physically exists on disk (across all sessions)
    all_on_disk: set[str] = {
        s.youtube_id
        for s in db.query(Song).filter(Song.youtube_id.in_(list(yt_ids))).all()
        if _file_on_disk(s)
    }
    new_count = len(yt_ids - all_on_disk)

    return PlaylistCheckResponse(
        session_id=None,
        url_hash="",
        new_songs=new_count,
        existing_songs=len(all_on_disk),
        is_new_session=True,
    )


@app.post("/api/download")
def start_download(req: DownloadRequest, db: DBSession = Depends(get_db)):
    """
    Queue downloads. Always creates a brand-new session per run.
    Songs that already exist on disk (found via any past session) are skipped
    unless mode="full".
    """
    url_hash = _url_hash(req.url)   # timestamp-seeded → unique per call
    playlist_id = _extract_playlist_id(req.url)

    try:
        yt_items, folder_name = _fetch_yt_items(req.url, single=(req.mode == "single"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not fetch playlist: {exc}")

    # Always create a fresh session
    session = DownloadSession(
        url=req.url,
        url_hash=url_hash,
        playlist_id=playlist_id,
        folder_name=folder_name,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # Which youtube_ids are already on disk (across ALL sessions)?
    yt_ids = [item["id"] for item in yt_items]
    on_disk_ids: set[str] = set()
    if req.mode != "full":
        on_disk_ids = {
            s.youtube_id
            for s in db.query(Song).filter(Song.youtube_id.in_(yt_ids)).all()
            if _file_on_disk(s)
        }

    queued: list[int] = []
    for item in yt_items:
        yt_id = item["id"]
        if yt_id in on_disk_ids:
            # Record as done without re-downloading
            existing = (
                db.query(Song)
                .filter(Song.youtube_id == yt_id, Song.status == "done")
                .order_by(Song.id.desc())
                .first()
            )
            song = Song(
                session_id=session.id,
                youtube_id=yt_id,
                title=existing.title if existing else item["title"],
                source_url=item["url"],
                status="done",
                file_path=existing.file_path if existing else None,
                artist=existing.artist if existing else None,
                bitrate=existing.bitrate if existing else None,
                metadata_source=existing.metadata_source if existing else "youtube",
                progress=100,
            )
            db.add(song)
        else:
            song = Song(
                session_id=session.id,
                youtube_id=yt_id,
                title=item["title"],
                source_url=item["url"],
                status="pending",
            )
            db.add(song)
            db.commit()
            db.refresh(song)
            queued.append(song.id)

    db.commit()

    for song_id in queued:
        task = download_song.delay(song_id)
        db.query(Song).filter(Song.id == song_id).update({"task_id": task.id})
    db.commit()

    return {
        "session_id": session.id,
        "queued": len(queued),
        "mode": req.mode,
    }


@app.post("/api/sessions/{session_id}/cancel")
def cancel_session(session_id: int, db: DBSession = Depends(get_db)):
    """Cancel all pending/active songs in a session."""
    from celery_app import celery as _celery

    in_progress = ["pending", "downloading", "tagging"]
    songs = (
        db.query(Song)
        .filter(Song.session_id == session_id, Song.status.in_(in_progress))
        .all()
    )
    for song in songs:
        if song.task_id:
            try:
                _celery.control.revoke(song.task_id, terminate=True, signal="SIGTERM")
            except Exception:
                pass
        song.status = "cancelled"
        song.error_message = "Cancelled by user"
    db.commit()
    return {"cancelled": len(songs)}


@app.get("/api/sessions/{session_id}/report")
def get_report(session_id: int, db: DBSession = Depends(get_db)):
    session = (
        db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    songs = db.query(Song).filter(Song.session_id == session_id).all()
    return {
        "session_id": session_id,
        "url": session.url,
        "last_synced_at": session.last_synced_at,
        "songs": [
            {
                "id": s.id,
                "title": s.title,
                "status": s.status,
                "source_url": s.source_url,
                "bitrate": s.bitrate,
                "metadata_source": s.metadata_source,
                "error_message": s.error_message,
                "progress": s.progress or 0,
                "task_id": s.task_id,
            }
            for s in songs
        ],
    }
