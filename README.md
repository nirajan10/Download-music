# HarmonySync

Download YouTube playlists and individual tracks as 320 kbps MP3 files. Supports SponsorBlock to strip intros, outros, and self-promo segments automatically.

## Features

- Download entire playlists or single tracks from YouTube
- 320 kbps MP3 output via yt-dlp + ffmpeg
- SponsorBlock integration — strips non-music segments automatically
- Playlist downloads go into a named subfolder; single tracks go to the root downloads directory
- Per-song progress bars with live status
- Cancel in-progress downloads
- Tracks already on disk are detected and skipped (checks actual files, not just the database)
- Cookie support for age-restricted or sign-in-required content

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- ffmpeg is bundled inside the Docker image — no host install needed

## Quick start

```bash
# 1. Clone the repository
git clone <repo-url>
cd Download-music

# 2. Create the downloads directory
mkdir -p downloads

# 3. Create an empty cookies file (required even if unused)
touch cookies.txt

# 4. Start everything
docker compose up -d

# 5. Open the UI
# http://localhost:3000
```

That's it. No environment variables or credentials required.

## Downloading music

### Playlist or channel

1. Open `http://localhost:3000`
2. Paste a YouTube playlist or channel URL
3. Click **Analyze** — the app checks which tracks are already on disk
4. Click **Sync N New Songs** to download only new tracks, or **Full Re-download** to re-archive everything

Songs are saved to `./downloads/<playlist name>/`.

### Single track

1. Switch to the **Single Track** tab
2. Paste any YouTube video URL (even one copied from inside a playlist — only that one track downloads)
3. Click **Analyze**, then **Download Track**

Single tracks are saved to `./downloads/` directly.

## File permissions (Linux)

Downloaded files are owned by `root` because the containers run as root. If your media player (VLC, etc.) reports "Permission denied", use one of the following fixes:

### Option 1 — Fix permissions once for all existing files

```bash
sudo chown -R $USER:$USER downloads/
```

### Option 2 — Fix permissions and make world-readable (no sudo needed after)

```bash
sudo chmod -R 755 downloads/
```

### Option 3 — Fix ownership and permissions in one command

```bash
sudo chown -R $USER:$USER downloads/ && chmod -R u+rw downloads/
```

### Option 4 — Run the app as your own user

Add a `user:` directive to both `backend` and `worker` in `docker-compose.yml`:

```yaml
backend:
  user: "1000:1000"   # replace with your uid:gid from `id -u` and `id -g`

worker:
  user: "1000:1000"
```

> **Note:** If you use this option and the `./data` directory doesn't exist yet, create it first:
> ```bash
> mkdir -p data && sudo chown 1000:1000 data
> ```

New files downloaded after the fix will be owned correctly automatically — the app calls `chmod 644` on each file and `chmod 755` on each directory after writing.

## Cookie support (age-restricted content)

If you get "Sign in to confirm your age" or "Please sign in" errors:

1. Export your YouTube cookies from a browser using the [cookies.txt extension](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Save the file as `cookies.txt` in the project root (replace the empty one)
3. Restart the app: `docker compose restart worker`

The cookies file is mounted into the container at `/cookies/cookies.txt`.

## Stopping and restarting

```bash
# Stop
docker compose down

# Stop and delete the database (fresh start)
docker compose down -v

# View logs
docker compose logs -f

# View worker logs only
docker compose logs -f worker
```

## Project structure

```
.
├── backend/          FastAPI + Celery worker
│   ├── main.py       API routes
│   ├── tasks.py      Download pipeline (yt-dlp)
│   ├── models.py     SQLAlchemy models
│   └── ...
├── frontend/         React + Vite + Tailwind UI
├── downloads/        Output directory (created on first run)
├── cookies.txt       YouTube session cookies (optional)
└── docker-compose.yml
```
