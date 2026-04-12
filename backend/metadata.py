"""
Spotify / iTunes metadata search, cover art fetching, and
mutagen-based ID3 tag reading/writing for MP3 files.
"""

import os
import re
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from mutagen.id3 import (
    APIC, ID3, ID3NoHeaderError,
    TALB, TCON, TDRC, TIT2, TPE1,
)
from PIL import Image

COVER_DIR_NAME = ".covers"
MAX_COVER_SIZE = (800, 800)


# ── Spotify client ───────────────────────────────────────────────────────────

def _get_spotify_creds() -> tuple[str, str]:
    """Load Spotify credentials from the DB settings table."""
    from database import SessionLocal
    from models import Setting
    db = SessionLocal()
    try:
        cid_row = db.query(Setting).filter(Setting.key == "spotify_client_id").first()
        secret_row = db.query(Setting).filter(Setting.key == "spotify_client_secret").first()
        cid = cid_row.value.strip() if cid_row else ""
        secret = secret_row.value.strip() if secret_row else ""
        return cid, secret
    finally:
        db.close()


def _get_spotify() -> Optional[spotipy.Spotify]:
    cid, secret = _get_spotify_creds()
    if not cid or not secret:
        return None
    try:
        auth = SpotifyClientCredentials(client_id=cid, client_secret=secret)
        return spotipy.Spotify(auth_manager=auth)
    except Exception:
        return None


def has_spotify_creds() -> bool:
    """Check if Spotify credentials are configured."""
    cid, secret = _get_spotify_creds()
    return bool(cid and secret)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_title(title: str) -> str:
    """Strip common YouTube noise from a title for better search results."""
    cleaned = re.sub(
        r"[\(\[].*?(official|video|audio|lyrics|hd|hq|4k|mv|music|visualizer|live|version).*?[\)\]]",
        "", title, flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -|·•")
    return cleaned


def _split_artist_title(raw: str) -> tuple[str, str]:
    """Try to split 'Artist - Title' from a YouTube title."""
    cleaned = _clean_title(raw)
    if " - " in cleaned:
        artist, track = cleaned.split(" - ", 1)
        return artist.strip(), track.strip()
    return "", cleaned.strip()


def _resize_cover(img_bytes: bytes) -> bytes:
    """Resize cover art to MAX_COVER_SIZE, return JPEG bytes."""
    img = Image.open(BytesIO(img_bytes))
    img.thumbnail(MAX_COVER_SIZE, Image.LANCZOS)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# ── Spotify search ───────────────────────────────────────────────────────────

def search_spotify(title: str, artist: str = "") -> list[dict]:
    """
    Search Spotify for tracks matching title/artist.
    Returns up to 5 candidate dicts with keys:
      spotify_id, title, artist, album, year, genre, cover_url, score
    """
    sp = _get_spotify()
    if not sp:
        return []

    cleaned = _clean_title(title)
    if not cleaned:
        return []

    query = f"track:{cleaned}"
    if artist:
        query += f" artist:{artist}"

    try:
        result = sp.search(q=query, type="track", limit=5)
    except Exception as e:
        print(f"[spotify] search error: {e}")
        return []

    items = result.get("tracks", {}).get("items", [])
    candidates = []
    for item in items:
        artists = item.get("artists", [])
        artist_name = ", ".join(a.get("name", "") for a in artists)

        album_obj = item.get("album", {})
        album_name = album_obj.get("name", "")
        release_date = album_obj.get("release_date", "")
        year = release_date[:4] if release_date else ""

        images = album_obj.get("images", [])
        cover_url = images[0]["url"] if images else ""

        # Spotify doesn't return genres on tracks; fetch from artist
        genre = ""
        if artists:
            try:
                artist_info = sp.artist(artists[0]["id"])
                genres = artist_info.get("genres", [])
                genre = genres[0] if genres else ""
            except Exception:
                pass

        popularity = item.get("popularity", 0)

        candidates.append({
            "spotify_id": item.get("id", ""),
            "title": item.get("name", ""),
            "artist": artist_name,
            "album": album_name,
            "year": year,
            "genre": genre,
            "cover_url": cover_url,
            "score": popularity,
        })

    return candidates


# ── iTunes search ────────────────────────────────────────────────────────────

def search_itunes(title: str, artist: str = "") -> list[dict]:
    """
    Search the iTunes Search API (free, no auth) for tracks matching title/artist.
    Returns up to 5 candidate dicts with keys:
      itunes_id, title, artist, album, year, genre, cover_url, score
    """
    cleaned = _clean_title(title)
    if not cleaned:
        return []

    term = f"{cleaned} {artist}".strip() if artist else cleaned

    try:
        r = requests.get(
            "https://itunes.apple.com/search",
            params={"term": term, "media": "music", "entity": "song", "limit": 5},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"[itunes] search error: {e}")
        return []

    candidates = []
    for idx, item in enumerate(data.get("results", [])):
        release_date = item.get("releaseDate", "")
        year = release_date[:4] if release_date else ""

        # artworkUrl100 → 600x600 variant
        art_url = item.get("artworkUrl100", "")
        if art_url:
            art_url = art_url.replace("100x100bb", "600x600bb")

        candidates.append({
            "itunes_id": item.get("trackId", 0),
            "title": item.get("trackName", ""),
            "artist": item.get("artistName", ""),
            "album": item.get("collectionName", ""),
            "year": year,
            "genre": item.get("primaryGenreName", ""),
            "cover_url": art_url,
            "score": max(0, 100 - idx * 20),
        })

    return candidates


# ── Cover art ─────────────────────────────────────────────────────────────────

def fetch_cover_art(cover_url: str) -> Optional[bytes]:
    """
    Fetch cover art from a Spotify image URL.
    Returns resized JPEG bytes, or None if unavailable.
    """
    if not cover_url:
        return None

    try:
        r = requests.get(cover_url, timeout=5)
        if r.status_code == 200:
            return _resize_cover(r.content)
    except Exception as e:
        print(f"[coverart] fetch error: {e}")

    return None


def save_cover_to_disk(img_bytes: bytes, song_id: int, downloads_dir: Path) -> str:
    """Save cover JPEG to .covers directory, return the path."""
    covers_dir = downloads_dir / COVER_DIR_NAME
    covers_dir.mkdir(parents=True, exist_ok=True)
    path = covers_dir / f"{song_id}.jpg"
    path.write_bytes(img_bytes)
    return str(path)


# ── Mutagen: read tags ────────────────────────────────────────────────────────

def read_tags(mp3_path: str) -> dict:
    """
    Read ID3 tags from an MP3 file.
    Returns {title, artist, album, year, genre, cover_bytes, cover_mime}.
    """
    result = {
        "title": None, "artist": None, "album": None,
        "year": None, "genre": None,
        "cover_bytes": None, "cover_mime": None,
    }

    try:
        tags = ID3(mp3_path)
    except (ID3NoHeaderError, Exception):
        return result

    if "TIT2" in tags:
        result["title"] = str(tags["TIT2"])
    if "TPE1" in tags:
        result["artist"] = str(tags["TPE1"])
    if "TALB" in tags:
        result["album"] = str(tags["TALB"])
    if "TDRC" in tags:
        result["year"] = str(tags["TDRC"])
    if "TCON" in tags:
        result["genre"] = str(tags["TCON"])

    for key in tags:
        if key.startswith("APIC"):
            frame = tags[key]
            result["cover_bytes"] = frame.data
            result["cover_mime"] = frame.mime
            break

    return result


# ── Mutagen: write tags ──────────────────────────────────────────────────────

def write_tags(
    mp3_path: str,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    year: Optional[str] = None,
    genre: Optional[str] = None,
    cover_bytes: Optional[bytes] = None,
) -> None:
    """
    Write ID3v2.3 tags to an MP3 file.
    Only overwrites fields that are not None.
    """
    try:
        tags = ID3(mp3_path)
    except ID3NoHeaderError:
        tags = ID3()

    if title is not None:
        tags["TIT2"] = TIT2(encoding=3, text=title)
    if artist is not None:
        tags["TPE1"] = TPE1(encoding=3, text=artist)
    if album is not None:
        tags["TALB"] = TALB(encoding=3, text=album)
    if year is not None:
        tags["TDRC"] = TDRC(encoding=3, text=str(year))
    if genre is not None:
        tags["TCON"] = TCON(encoding=3, text=genre)

    if cover_bytes is not None:
        tags["APIC"] = APIC(
            encoding=3,
            mime="image/jpeg",
            type=3,       # Cover (front)
            desc="Cover",
            data=cover_bytes,
        )

    tags.save(mp3_path, v2_version=3)


# ── High-level: auto-tag a song ──────────────────────────────────────────────

def auto_tag(
    mp3_path: str,
    raw_title: str,
    song_id: int,
    downloads_dir: Path,
    source: str = "itunes",
) -> Optional[dict]:
    """
    Search the given source (itunes or spotify) using the YouTube title,
    embed the best match's metadata + cover art into the MP3.

    Returns metadata dict on success, None if no match found.
    """
    if source == "spotify":
        artist_hint, title_hint = _split_artist_title(raw_title)
        candidates = search_spotify(title_hint, artist_hint)
    else:
        # For iTunes: use the full cleaned title as the query.
        # Splitting "Artist - Title" can produce reversed results for many
        # YouTube titles (e.g. "Paradise - Coldplay"), so let iTunes figure
        # out the match from the combined string.
        cleaned_query = _clean_title(raw_title)
        candidates = search_itunes(cleaned_query)

    if not candidates:
        return None

    best = candidates[0]

    cover_bytes = fetch_cover_art(best.get("cover_url", ""))

    cover_path = None
    if cover_bytes:
        cover_path = save_cover_to_disk(cover_bytes, song_id, downloads_dir)

    write_tags(
        mp3_path,
        title=best["title"],
        artist=best["artist"],
        album=best.get("album"),
        year=best.get("year"),
        genre=best.get("genre"),
        cover_bytes=cover_bytes,
    )

    result = {
        "title": best["title"],
        "artist": best["artist"],
        "album": best.get("album", ""),
        "year": best.get("year", ""),
        "genre": best.get("genre", ""),
        "cover_path": cover_path,
    }

    if source == "spotify":
        result["spotify_id"] = best.get("spotify_id", "")
    else:
        result["itunes_id"] = best.get("itunes_id", 0)

    return result
