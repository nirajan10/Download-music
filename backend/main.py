import hashlib
import re
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import yt_dlp
from pathlib import Path
from sqlalchemy import text
from fastapi import Depends, FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy.orm import Session as DBSession

from database import Base, engine, get_db
from models import DownloadSession, Song, Setting
from fastapi import Query
from schemas import (
    DownloadRequest, PlaylistCheckResponse, SessionOut,
    MetadataOut, MetadataUpdate, SpotifySearchRequest,
    SpotifyCandidate, SpotifyApplyRequest,
    ItunesCandidate, ItunesApplyRequest,
    RenameRequest, SessionRenameRequest,
)
from tasks import download_song, tag_song
from metadata import (
    search_spotify, search_itunes, fetch_cover_art, save_cover_to_disk,
    read_tags, write_tags, auto_tag, _split_artist_title, _resize_cover,
    has_spotify_creds,
)

DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "/downloads"))

Base.metadata.create_all(bind=engine)

# Migrate: add columns introduced after initial schema
with engine.connect() as _conn:
    for stmt in [
        "ALTER TABLE songs ADD COLUMN progress INTEGER DEFAULT 0",
        "ALTER TABLE songs ADD COLUMN task_id VARCHAR",
        "ALTER TABLE sessions ADD COLUMN folder_name VARCHAR",
        "ALTER TABLE songs ADD COLUMN album VARCHAR",
        "ALTER TABLE songs ADD COLUMN year INTEGER",
        "ALTER TABLE songs ADD COLUMN genre VARCHAR",
        "ALTER TABLE songs ADD COLUMN cover_path VARCHAR",
        "ALTER TABLE songs ADD COLUMN musicbrainz_id VARCHAR",
        "ALTER TABLE songs ADD COLUMN spotify_id VARCHAR",
        "ALTER TABLE songs ADD COLUMN itunes_id INTEGER",
        "ALTER TABLE sessions ADD COLUMN name VARCHAR",
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


def _safe_name(s: str) -> str:
    """Strip filesystem-unsafe characters from a filename component."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip(". ")


def _unique_folder(base: str, downloads_dir: Path) -> str:
    """Return `base` if that subfolder doesn't exist yet, else append (2), (3), …"""
    candidate = base
    n = 2
    while (downloads_dir / candidate).exists():
        candidate = f"{base} ({n})"
        n += 1
    return candidate


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


def _fetch_yt_items(url: str, single: bool = False) -> tuple[list[dict], str | None, str | None]:
    """
    Return (items, folder_name, raw_title).
    folder_name is the sanitized playlist title for use as directory name.
    raw_title is the unsanitized playlist title for display.
    Both are None for single videos.
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
    raw_title = info.get("title", "").strip() if (is_playlist and not single) else None
    folder_name = _safe_folder(raw_title) if raw_title else None

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
    return items, folder_name, raw_title


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
            "name": s.name,
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
        yt_items, _, raw_title = _fetch_yt_items(req.url, single=(req.mode == "single"))
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

    # Look up existing folder from the most recent session with the same playlist_id
    existing_folder: str | None = None
    playlist_id = _extract_playlist_id(req.url)
    if playlist_id:
        recent = (
            db.query(DownloadSession)
            .filter(DownloadSession.playlist_id == playlist_id)
            .order_by(DownloadSession.last_synced_at.desc())
            .first()
        )
        if recent and recent.folder_name:
            existing_folder = recent.folder_name

    return PlaylistCheckResponse(
        session_id=None,
        url_hash="",
        new_songs=new_count,
        existing_songs=len(all_on_disk),
        is_new_session=True,
        playlist_title=raw_title,
        existing_folder=existing_folder,
    )


_SINGLES_PLAYLIST_ID = "__singles__"
_UPLOADS_PLAYLIST_ID = "__uploads__"


@app.post("/api/upload")
async def upload_songs(
    files: list[UploadFile] = File(...),
    db: DBSession = Depends(get_db),
):
    """
    Accept local MP3 files, save them to disk, read any existing ID3 tags,
    and create Song records ready for metadata editing.
    Groups uploads into a shared session for 30 minutes of inactivity
    (same pattern as singles).
    """
    import uuid

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    existing_upload = (
        db.query(DownloadSession)
        .filter(
            DownloadSession.playlist_id == _UPLOADS_PLAYLIST_ID,
            DownloadSession.last_synced_at >= cutoff,
        )
        .order_by(DownloadSession.last_synced_at.desc())
        .first()
    )

    if existing_upload:
        session = existing_upload
        session.last_synced_at = datetime.now(timezone.utc)
        db.commit()
    else:
        now = datetime.now()
        date_str = f"{now.strftime('%b')} {now.day}"
        folder_name = f"Uploads - {now.strftime('%Y-%m-%d')}"
        session = DownloadSession(
            url="local://uploads",
            url_hash=_url_hash("local://uploads"),
            playlist_id=_UPLOADS_PLAYLIST_ID,
            name=f"Uploads · {date_str}",
            folder_name=folder_name,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    output_dir = DOWNLOAD_DIR / session.folder_name
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(output_dir, 0o755)

    added = 0
    for file in files:
        if not file.filename:
            continue

        stem = Path(file.filename).stem
        suffix = Path(file.filename).suffix.lower() or ".mp3"
        safe_stem = _safe_name(stem)
        dest_path = output_dir / f"{safe_stem}{suffix}"

        # Avoid name collisions
        n = 2
        while dest_path.exists():
            dest_path = output_dir / f"{safe_stem} ({n}){suffix}"
            n += 1

        content = await file.read()
        dest_path.write_bytes(content)
        os.chmod(dest_path, 0o644)

        # Read any existing ID3 tags
        tags: dict = {}
        if suffix == ".mp3":
            try:
                tags = read_tags(str(dest_path))
            except Exception:
                pass

        title = tags.get("title") or stem
        year_val: int | None = None
        if tags.get("year"):
            try:
                year_val = int(str(tags["year"])[:4])
            except ValueError:
                pass

        local_id = f"local_{uuid.uuid4().hex[:12]}"
        song = Song(
            session_id=session.id,
            youtube_id=local_id,
            title=title,
            artist=tags.get("artist"),
            album=tags.get("album"),
            year=year_val,
            genre=tags.get("genre"),
            file_path=str(dest_path),
            status="done",
            metadata_source="manual",
            progress=100,
        )
        db.add(song)
        db.commit()
        db.refresh(song)

        # Persist any embedded cover art
        if tags.get("cover_bytes"):
            try:
                cover_path = save_cover_to_disk(tags["cover_bytes"], song.id, DOWNLOAD_DIR)
                song.cover_path = cover_path
                db.commit()
            except Exception:
                pass

        added += 1

    # Update session song count
    session.total_songs = (
        db.query(Song)
        .filter(Song.session_id == session.id, Song.status == "done")
        .count()
    )
    db.commit()

    return {"session_id": session.id, "added": added}


@app.post("/api/download")
def start_download(req: DownloadRequest, db: DBSession = Depends(get_db)):
    """
    Queue downloads. Creates a fresh session per run, except for singles which
    are grouped into a shared session for 30 minutes of inactivity.
    Songs that already exist on disk (found via any past session) are skipped
    unless mode="full".
    """
    is_single = (req.mode == "single")
    url_hash = _url_hash(req.url)
    playlist_id = _extract_playlist_id(req.url)

    try:
        yt_items, derived_folder, raw_title = _fetch_yt_items(req.url, single=is_single)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not fetch playlist: {exc}")

    if is_single:
        # Group single-song downloads: reuse the most recent singles session if
        # it had activity within the last 30 minutes.
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        existing_singles = (
            db.query(DownloadSession)
            .filter(
                DownloadSession.playlist_id == _SINGLES_PLAYLIST_ID,
                DownloadSession.last_synced_at >= cutoff,
            )
            .order_by(DownloadSession.last_synced_at.desc())
            .first()
        )
        if existing_singles:
            session = existing_singles
            session.last_synced_at = datetime.now(timezone.utc)
            db.commit()
        else:
            now = datetime.now()
            date_str = f"{now.strftime('%b')} {now.day}"  # e.g. "Apr 12"
            session = DownloadSession(
                url=req.url,
                url_hash=url_hash,
                playlist_id=_SINGLES_PLAYLIST_ID,
                name=f"Singles · {date_str}",
                folder_name=f"Singles - {now.strftime('%Y-%m-%d')}",
            )
            db.add(session)
            db.commit()
            db.refresh(session)
    else:
        # Playlist / channel
        session_name = req.name or raw_title
        if req.mode == "full":
            # Full re-download always lands in a brand-new folder so it never
            # overwrites the previous archive.
            base = _safe_folder(session_name or "playlist")
            folder_name = _unique_folder(base, DOWNLOAD_DIR)
        elif req.folder_override:
            folder_name = req.folder_override
        elif req.name:
            folder_name = _safe_folder(req.name)
        else:
            folder_name = derived_folder

        session = DownloadSession(
            url=req.url,
            url_hash=url_hash,
            playlist_id=playlist_id,
            name=session_name,
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
        task = download_song.delay(
            song_id,
            auto_metadata=req.auto_metadata,
            auto_metadata_source=req.auto_metadata_source,
            quality=req.quality,
        )
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


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, db: DBSession = Depends(get_db)):
    """Remove a session and all its songs from history (files on disk are kept)."""
    from celery_app import celery as _celery

    session = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Revoke any running tasks before deleting
    active_songs = (
        db.query(Song)
        .filter(Song.session_id == session_id, Song.status.in_(["pending", "downloading", "tagging"]))
        .all()
    )
    for song in active_songs:
        if song.task_id:
            try:
                _celery.control.revoke(song.task_id, terminate=True, signal="SIGTERM")
            except Exception:
                pass

    db.delete(session)
    db.commit()
    return {"deleted": 1}


@app.delete("/api/sessions")
def delete_all_sessions(db: DBSession = Depends(get_db)):
    """Remove all sessions and songs from history (files on disk are kept)."""
    from celery_app import celery as _celery

    active_songs = (
        db.query(Song)
        .filter(Song.status.in_(["pending", "downloading", "tagging"]))
        .all()
    )
    for song in active_songs:
        if song.task_id:
            try:
                _celery.control.revoke(song.task_id, terminate=True, signal="SIGTERM")
            except Exception:
                pass

    count = db.query(DownloadSession).count()
    db.query(Song).delete()
    db.query(DownloadSession).delete()
    db.commit()
    return {"deleted": count}


@app.patch("/api/sessions/{session_id}/name")
def rename_session(session_id: int, body: SessionRenameRequest, db: DBSession = Depends(get_db)):
    """Update the display name of a session."""
    session = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.name = body.name.strip() or None
    db.commit()
    return {"name": session.name}


@app.post("/api/sessions/{session_id}/rename-all")
def rename_all_songs(session_id: int, db: DBSession = Depends(get_db)):
    """Rename every downloaded song file to 'Title - Artist.mp3' (or 'Title.mp3')."""
    session = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    songs = db.query(Song).filter(
        Song.session_id == session_id,
        Song.status == "done",
    ).all()

    renamed = 0
    skipped = 0

    for song in songs:
        if not song.file_path or not os.path.isfile(song.file_path):
            skipped += 1
            continue
        if not song.title:
            skipped += 1
            continue

        parts = [p for p in [song.title, song.artist] if p]
        new_stem = _safe_name(" - ".join(parts))
        if not new_stem:
            skipped += 1
            continue

        old_path = Path(song.file_path)
        new_path = old_path.parent / f"{new_stem}.mp3"

        if new_path == old_path:
            continue  # already correctly named

        if new_path.exists():
            skipped += 1
            continue  # avoid overwriting another file

        try:
            old_path.rename(new_path)
            song.file_path = str(new_path)
            renamed += 1
        except Exception as exc:
            print(f"[rename-all] failed for song {song.id}: {exc}")
            skipped += 1

    db.commit()
    return {"renamed": renamed, "skipped": skipped}


@app.post("/api/sessions/{session_id}/tag-all")
def tag_all_songs(
    session_id: int,
    source: str = Query("itunes"),
    db: DBSession = Depends(get_db),
):
    """Queue re-tagging for every downloaded song in the session."""
    session = db.query(DownloadSession).filter(DownloadSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    songs = db.query(Song).filter(
        Song.session_id == session_id,
        Song.status == "done",
    ).all()

    queued = []
    for song in songs:
        if song.file_path and os.path.isfile(song.file_path):
            task = tag_song.delay(song.id, source)
            song.task_id = task.id
            queued.append(song.id)

    db.commit()
    return {"queued": len(queued), "source": source}


@app.post("/api/songs/{song_id}/retry")
def retry_song(song_id: int, db: DBSession = Depends(get_db)):
    """Re-queue a failed or cancelled song for download."""
    song = _get_song_or_404(song_id, db)
    if song.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=400, detail="Song is not failed or cancelled")
    song.status = "pending"
    song.error_message = None
    song.progress = 0
    db.commit()
    task = download_song.delay(song_id)
    song.task_id = task.id
    db.commit()
    return {"song_id": song_id, "status": "pending"}


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
                "artist": s.artist,
                "album": s.album,
                "year": s.year,
                "genre": s.genre,
                "status": s.status,
                "source_url": s.source_url,
                "bitrate": s.bitrate,
                "metadata_source": s.metadata_source,
                "error_message": s.error_message,
                "progress": s.progress or 0,
                "task_id": s.task_id,
                "has_cover": bool(s.cover_path and os.path.isfile(s.cover_path)),
                "spotify_id": s.spotify_id,
                "itunes_id": s.itunes_id,
            }
            for s in songs
        ],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Metadata endpoints
# ──────────────────────────────────────────────────────────────────────────────

def _get_song_or_404(song_id: int, db: DBSession) -> Song:
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@app.get("/api/songs/{song_id}/metadata", response_model=MetadataOut)
def get_song_metadata(song_id: int, db: DBSession = Depends(get_db)):
    """Read metadata from the DB + actual ID3 tags from the file."""
    song = _get_song_or_404(song_id, db)

    cover_url = None
    if song.file_path and os.path.isfile(song.file_path):
        tags = read_tags(song.file_path)
        if tags.get("cover_bytes"):
            cover_url = f"/api/songs/{song_id}/cover"

    filename = Path(song.file_path).stem if song.file_path else None

    return MetadataOut(
        title=song.title,
        artist=song.artist,
        album=song.album,
        year=str(song.year) if song.year else None,
        genre=song.genre,
        cover_url=cover_url,
        metadata_source=song.metadata_source,
        spotify_id=song.spotify_id,
        itunes_id=song.itunes_id,
        filename=filename,
    )


@app.put("/api/songs/{song_id}/metadata", response_model=MetadataOut)
def update_song_metadata(song_id: int, body: MetadataUpdate, db: DBSession = Depends(get_db)):
    """Save manually edited metadata to the MP3 and DB."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=400, detail="Song file not found on disk")

    write_tags(
        song.file_path,
        title=body.title,
        artist=body.artist,
        album=body.album,
        year=body.year,
        genre=body.genre,
    )

    if body.title is not None:
        song.title = body.title
    if body.artist is not None:
        song.artist = body.artist
    if body.album is not None:
        song.album = body.album
    if body.year is not None:
        song.year = int(body.year) if body.year else None
    if body.genre is not None:
        song.genre = body.genre
    song.metadata_source = "manual"
    db.commit()

    cover_url = None
    tags = read_tags(song.file_path)
    if tags.get("cover_bytes"):
        cover_url = f"/api/songs/{song_id}/cover"

    return MetadataOut(
        title=song.title,
        artist=song.artist,
        album=song.album,
        year=str(song.year) if song.year else None,
        genre=song.genre,
        cover_url=cover_url,
        metadata_source=song.metadata_source,
        spotify_id=song.spotify_id,
        itunes_id=song.itunes_id,
    )


@app.post("/api/songs/{song_id}/rename")
def rename_song_file(song_id: int, body: RenameRequest, db: DBSession = Depends(get_db)):
    """Rename the song's MP3 file on disk and update the DB path."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=400, detail="Song file not found on disk")

    new_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", body.new_name).strip(". ")
    if not new_name:
        raise HTTPException(status_code=400, detail="New name is empty after sanitisation")

    old_path = Path(song.file_path)
    new_path = old_path.parent / f"{new_name}.mp3"

    if new_path != old_path:
        if new_path.exists():
            raise HTTPException(status_code=409, detail="A file with that name already exists")
        old_path.rename(new_path)
        song.file_path = str(new_path)
        db.commit()

    return {"filename": new_name, "file_path": str(new_path)}


@app.post("/api/songs/{song_id}/metadata/fetch")
def fetch_metadata_candidates(
    song_id: int,
    body: SpotifySearchRequest,
    source: str = Query("itunes"),
    db: DBSession = Depends(get_db),
):
    """Search iTunes or Spotify for candidates. Does NOT auto-save."""
    song = _get_song_or_404(song_id, db)

    title = body.title or song.title or ""
    artist = body.artist or song.artist or ""

    if not title:
        raise HTTPException(status_code=400, detail="No title to search for")

    artist_hint, title_hint = _split_artist_title(title)
    if not artist and artist_hint:
        artist = artist_hint
        title = title_hint

    if source == "spotify":
        candidates = search_spotify(title, artist)
        return [
            SpotifyCandidate(
                spotify_id=c["spotify_id"],
                title=c["title"],
                artist=c["artist"],
                album=c.get("album"),
                year=c.get("year"),
                genre=c.get("genre"),
                cover_url=c.get("cover_url"),
                score=c.get("score", 0),
            )
            for c in candidates
        ]
    else:
        candidates = search_itunes(title, artist)
        return [
            ItunesCandidate(
                itunes_id=c["itunes_id"],
                title=c["title"],
                artist=c["artist"],
                album=c.get("album"),
                year=c.get("year"),
                genre=c.get("genre"),
                cover_url=c.get("cover_url"),
                score=c.get("score", 0),
            )
            for c in candidates
        ]


@app.post("/api/songs/{song_id}/metadata/apply", response_model=MetadataOut)
def apply_spotify_match(
    song_id: int,
    body: SpotifyApplyRequest,
    db: DBSession = Depends(get_db),
):
    """Apply a chosen Spotify result (user may have edited fields). Fetches cover art."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=400, detail="Song file not found on disk")

    cover_bytes = fetch_cover_art(body.cover_url) if body.cover_url else None
    cover_path = None
    if cover_bytes:
        cover_path = save_cover_to_disk(cover_bytes, song_id, DOWNLOAD_DIR)

    write_tags(
        song.file_path,
        title=body.title,
        artist=body.artist,
        album=body.album,
        year=body.year,
        genre=body.genre,
        cover_bytes=cover_bytes,
    )

    if body.title:
        song.title = body.title
    if body.artist:
        song.artist = body.artist
    song.album = body.album
    song.year = int(body.year) if body.year else None
    song.genre = body.genre
    song.spotify_id = body.spotify_id
    song.metadata_source = "spotify"
    if cover_path:
        song.cover_path = cover_path
    db.commit()

    cover_url = f"/api/songs/{song_id}/cover" if cover_bytes else None
    return MetadataOut(
        title=song.title,
        artist=song.artist,
        album=song.album,
        year=str(song.year) if song.year else None,
        genre=song.genre,
        cover_url=cover_url,
        metadata_source=song.metadata_source,
        spotify_id=song.spotify_id,
        itunes_id=song.itunes_id,
    )


@app.post("/api/songs/{song_id}/metadata/apply/itunes", response_model=MetadataOut)
def apply_itunes_match(
    song_id: int,
    body: ItunesApplyRequest,
    db: DBSession = Depends(get_db),
):
    """Apply a chosen iTunes result. Fetches cover art and embeds metadata."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=400, detail="Song file not found on disk")

    cover_bytes = fetch_cover_art(body.cover_url) if body.cover_url else None
    cover_path = None
    if cover_bytes:
        cover_path = save_cover_to_disk(cover_bytes, song_id, DOWNLOAD_DIR)

    write_tags(
        song.file_path,
        title=body.title,
        artist=body.artist,
        album=body.album,
        year=body.year,
        genre=body.genre,
        cover_bytes=cover_bytes,
    )

    if body.title:
        song.title = body.title
    if body.artist:
        song.artist = body.artist
    song.album = body.album
    song.year = int(body.year) if body.year else None
    song.genre = body.genre
    song.itunes_id = body.itunes_id
    song.metadata_source = "itunes"
    if cover_path:
        song.cover_path = cover_path
    db.commit()

    cover_url = f"/api/songs/{song_id}/cover" if cover_bytes else None
    return MetadataOut(
        title=song.title,
        artist=song.artist,
        album=song.album,
        year=str(song.year) if song.year else None,
        genre=song.genre,
        cover_url=cover_url,
        metadata_source=song.metadata_source,
        spotify_id=song.spotify_id,
        itunes_id=song.itunes_id,
    )


@app.get("/api/songs/{song_id}/cover")
def get_song_cover(song_id: int, db: DBSession = Depends(get_db)):
    """Serve the cover art embedded in the MP3."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=404, detail="Song file not found")

    tags = read_tags(song.file_path)
    if not tags.get("cover_bytes"):
        raise HTTPException(status_code=404, detail="No cover art found")

    return Response(
        content=tags["cover_bytes"],
        media_type=tags.get("cover_mime", "image/jpeg"),
    )


@app.post("/api/songs/{song_id}/cover")
async def upload_song_cover(
    song_id: int,
    file: UploadFile = File(...),
    db: DBSession = Depends(get_db),
):
    """Upload a custom cover art image for a song."""
    song = _get_song_or_404(song_id, db)
    if not song.file_path or not os.path.isfile(song.file_path):
        raise HTTPException(status_code=400, detail="Song file not found on disk")

    img_data = await file.read()
    if len(img_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB)")

    try:
        resized = _resize_cover(img_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    cover_path = save_cover_to_disk(resized, song_id, DOWNLOAD_DIR)
    write_tags(song.file_path, cover_bytes=resized)

    song.cover_path = cover_path
    db.commit()

    return {"cover_url": f"/api/songs/{song_id}/cover"}


# ──────────────────────────────────────────────────────────────────────────────
# Settings endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/settings/spotify")
def get_spotify_settings(db: DBSession = Depends(get_db)):
    """Return whether Spotify credentials are configured (never expose the secrets)."""
    from metadata import has_spotify_creds
    cid_row = db.query(Setting).filter(Setting.key == "spotify_client_id").first()
    return {
        "configured": has_spotify_creds(),
        "client_id": cid_row.value if cid_row else "",
    }


@app.post("/api/settings/spotify")
def save_spotify_settings(body: dict, db: DBSession = Depends(get_db)):
    """Save Spotify credentials to the database."""
    cid = (body.get("client_id") or "").strip()
    secret = (body.get("client_secret") or "").strip()

    for key, value in [("spotify_client_id", cid), ("spotify_client_secret", secret)]:
        row = db.query(Setting).filter(Setting.key == key).first()
        if value:
            if row:
                row.value = value
            else:
                db.add(Setting(key=key, value=value))
        elif row:
            db.delete(row)

    db.commit()
    return {"configured": bool(cid and secret)}


@app.delete("/api/settings/spotify")
def clear_spotify_settings(db: DBSession = Depends(get_db)):
    """Remove Spotify credentials."""
    for key in ["spotify_client_id", "spotify_client_secret"]:
        row = db.query(Setting).filter(Setting.key == key).first()
        if row:
            db.delete(row)
    db.commit()
    return {"configured": False}
