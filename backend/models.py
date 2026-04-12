from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class DownloadSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, nullable=False, index=True)
    url_hash = Column(String(16), nullable=False, index=True)
    playlist_id = Column(String, nullable=True)
    last_synced_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    total_songs = Column(Integer, default=0)
    folder_name = Column(String, nullable=True)

    songs = relationship("Song", back_populates="session", cascade="all, delete-orphan")


class Song(Base):
    __tablename__ = "songs"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    youtube_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=True)
    artist = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    album = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    genre = Column(String, nullable=True)
    cover_path = Column(String, nullable=True)
    spotify_id = Column(String, nullable=True)
    itunes_id = Column(Integer, nullable=True)
    # pending | downloading | tagging | done | failed | cancelled
    status = Column(String, default="pending", nullable=False)
    # youtube | ytmusic | spotify | itunes | manual
    metadata_source = Column(String, default="youtube", nullable=False)
    bitrate = Column(Integer, nullable=True)
    source_url = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    progress = Column(Integer, default=0)
    task_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    session = relationship("DownloadSession", back_populates="songs")


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
