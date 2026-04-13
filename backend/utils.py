"""
Shared audio-processing utilities used by both the Celery worker (tasks.py)
and the FastAPI request handlers (main.py).
"""

import json
import os
import subprocess
from pathlib import Path


def normalize_loudness(file_path: str, target_lufs: float = -14.0) -> bool:
    """
    Normalize *file_path* to *target_lufs* LUFS in-place using ffmpeg's
    two-pass EBU R128 loudnorm filter.  ID3 tags and cover art are preserved.
    Returns True on success, False on any failure (original file untouched).
    """
    from metadata import read_tags, write_tags

    # ── Pass 1: measure loudness ──────────────────────────────────────────────
    p1 = subprocess.run(
        [
            "ffmpeg", "-y", "-i", file_path,
            "-af", f"loudnorm=I={target_lufs}:TP=-1.0:LRA=11:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True, text=True,
    )
    # loudnorm prints its JSON block to stderr
    stderr = p1.stderr
    j_start = stderr.rfind("{")
    j_end   = stderr.rfind("}") + 1
    if j_start == -1 or j_end == 0:
        print(f"[loudnorm] pass 1 produced no JSON for {file_path}")
        return False
    try:
        stats = json.loads(stderr[j_start:j_end])
    except Exception as exc:
        print(f"[loudnorm] JSON parse failed: {exc}")
        return False

    # ── Save tags before pass 2 strips them ──────────────────────────────────
    existing_tags = read_tags(file_path)

    # ── Pass 2: apply linear correction ──────────────────────────────────────
    af = (
        f"loudnorm=I={target_lufs}:TP=-1.0:LRA=11"
        f":measured_I={stats['input_i']}"
        f":measured_TP={stats['input_tp']}"
        f":measured_LRA={stats['input_lra']}"
        f":measured_thresh={stats['input_thresh']}"
        f":offset={stats['target_offset']}"
        f":linear=true"
    )
    tmp_path = Path(file_path).with_suffix(".norm_tmp.mp3")
    p2 = subprocess.run(
        [
            "ffmpeg", "-y", "-i", file_path,
            "-af", af,
            "-ar", "44100",
            "-c:a", "libmp3lame", "-q:a", "2",
            str(tmp_path),
        ],
        capture_output=True, text=True,
    )
    if p2.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        print(f"[loudnorm] pass 2 failed: {p2.stderr[-300:]}")
        return False

    os.replace(str(tmp_path), file_path)

    # ── Restore ID3 tags ──────────────────────────────────────────────────────
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
    except Exception as exc:
        print(f"[loudnorm] write_tags failed after normalization: {exc}")

    measured = stats.get("input_i", "?")
    print(f"[loudnorm] {Path(file_path).name}: {measured} → {target_lufs} LUFS")
    return True


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
