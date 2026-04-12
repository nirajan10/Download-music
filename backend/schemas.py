from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SongOut(BaseModel):
    id: int
    youtube_id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[int] = None
    genre: Optional[str] = None
    file_path: Optional[str] = None
    status: str
    metadata_source: str
    bitrate: Optional[int] = None
    source_url: Optional[str] = None
    error_message: Optional[str] = None
    progress: Optional[int] = 0
    has_cover: bool = False
    spotify_id: Optional[str] = None

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: int
    url: str
    url_hash: str
    playlist_id: Optional[str] = None
    last_synced_at: datetime
    total_songs: int
    songs: list[SongOut] = []

    model_config = {"from_attributes": True}


class DownloadRequest(BaseModel):
    url: str
    mode: str = "sync"  # "sync" | "full" | "single"
    auto_metadata: bool = False
    auto_metadata_source: str = "itunes"  # "itunes" | "spotify"
    quality: int = 320  # 128 | 192 | 256 | 320


class PlaylistCheckResponse(BaseModel):
    session_id: Optional[int] = None
    url_hash: str
    new_songs: int
    existing_songs: int
    is_new_session: bool


# ── Metadata schemas ─────────────────────────────────────────────────────────

class MetadataOut(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    cover_url: Optional[str] = None
    metadata_source: str = "youtube"
    spotify_id: Optional[str] = None
    itunes_id: Optional[int] = None


class MetadataUpdate(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None


class SpotifySearchRequest(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None


class SpotifyCandidate(BaseModel):
    spotify_id: str
    title: str
    artist: str
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    cover_url: Optional[str] = None
    score: int = 0


class SpotifyApplyRequest(BaseModel):
    spotify_id: str
    cover_url: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None


class ItunesCandidate(BaseModel):
    itunes_id: int
    title: str
    artist: str
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
    cover_url: Optional[str] = None
    score: int = 0


class ItunesApplyRequest(BaseModel):
    itunes_id: int
    cover_url: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[str] = None
    genre: Optional[str] = None
