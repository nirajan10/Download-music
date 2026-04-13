"""
Shared audio-processing utilities used by both the Celery worker (tasks.py)
and the FastAPI request handlers (main.py).
"""

import os
import subprocess
from pathlib import Path


def ffmpeg_cut(file_path: str, segments_to_remove: list[dict]) -> float | None:
    """
    Cut out the given segments from *file_path* in-place using ffmpeg.

    Parameters
    ----------
    file_path : str
        Absolute path to an MP3 file.
    segments_to_remove : list of {"start": float, "end": float}
        Segments (in seconds) to REMOVE.  Remaining audio is stitched together.

    Returns
    -------
    float | None
        New duration in seconds, or None if nothing was cut (empty list,
        ffprobe failure, or ffmpeg failure — original file is always untouched
        on failure).
    """
    if not segments_to_remove:
        return None

    # ── 1. Get duration via ffprobe ───────────────────────────────────────────
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        print(f"[ffmpeg_cut] ffprobe failed for {file_path}: {probe.stderr[:200]}")
        return None

    # ── 2. Sort segments and compute kept intervals ───────────────────────────
    segs = sorted(segments_to_remove, key=lambda s: s["start"])
    kept: list[tuple[float, float | None]] = []
    cursor = 0.0
    for seg in segs:
        if seg["start"] > cursor:
            kept.append((cursor, seg["start"]))
        cursor = max(cursor, seg["end"])
    if cursor < duration:
        kept.append((cursor, None))  # None = "to end of file"

    if not kept:
        return None  # would delete entire file — bail out

    # ── 3. Save existing ID3 tags before ffmpeg strips them ───────────────────
    from metadata import read_tags, write_tags
    existing_tags = read_tags(file_path)

    # ── 4. Build ffmpeg filter_complex ────────────────────────────────────────
    parts: list[str] = []
    labels: list[str] = []
    for i, (start, end) in enumerate(kept):
        lbl = f"s{i}"
        labels.append(f"[{lbl}]")
        if end is None:
            parts.append(f"[0:a]atrim=start={start}[{lbl}]")
        else:
            parts.append(f"[0:a]atrim=start={start}:end={end}[{lbl}]")
    parts.append("".join(labels) + f"concat=n={len(kept)}:v=0:a=1[out]")
    filter_complex = ";".join(parts)

    # ── 5. Run ffmpeg → temp file in same directory (atomic replace) ──────────
    tmp_path = Path(file_path).with_suffix(".cut_tmp.mp3")
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", file_path,
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-q:a", "0",          # LAME VBR best quality
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        print(f"[ffmpeg_cut] ffmpeg failed: {result.stderr[-400:]}")
        return None

    os.replace(str(tmp_path), file_path)

    # ── 6. Re-apply ID3 tags (ffmpeg strips them) ─────────────────────────────
    try:
        write_tags(
            file_path,
            title=existing_tags.get("title"),
            artist=existing_tags.get("artist"),
            album=existing_tags.get("album"),
            year=existing_tags.get("year"),
            genre=existing_tags.get("genre"),
            cover_bytes=existing_tags.get("cover_bytes"),
        )
    except Exception as e:
        print(f"[ffmpeg_cut] write_tags failed after cut: {e}")

    # ── 7. Return new duration ────────────────────────────────────────────────
    probe2 = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(probe2.stdout.strip())
    except ValueError:
        return None
