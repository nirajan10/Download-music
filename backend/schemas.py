from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SongOut(BaseModel):
    id: int
    youtube_id: str
    title: Optional[str] = None
    artist: Optional[str] = None
    file_path: Optional[str] = None
    status: str
    metadata_source: str
    bitrate: Optional[int] = None
    source_url: Optional[str] = None
    error_message: Optional[str] = None

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
    mode: str = "sync"  # "sync" | "full"


class PlaylistCheckResponse(BaseModel):
    session_id: Optional[int] = None
    url_hash: str
    new_songs: int
    existing_songs: int
    is_new_session: bool
