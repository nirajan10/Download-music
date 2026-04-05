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

- [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) (includes Docker Compose)

ffmpeg is bundled inside the Docker image — no host install needed.

## Quick start

Open **Command Prompt** or **PowerShell** and run:

```bat
:: 1. Clone the repository
git clone <repo-url>
cd Download-music

:: 2. Create the downloads directory
mkdir downloads

:: 3. Create an empty cookies file (required even if unused)
type nul > cookies.txt

:: 4. Start everything
docker compose up -d

:: 5. Open the UI
:: http://localhost:3000
```

That's it. No environment variables or credentials required.

## Downloading music

### Playlist or channel

1. Open `http://localhost:3000`
2. Paste a YouTube playlist or channel URL
3. Click **Analyze** — the app checks which tracks are already on disk
4. Click **Sync N New Songs** to download only new tracks, or **Full Re-download** to re-archive everything

Songs are saved to `downloads\<playlist name>\`.

### Single track

1. Switch to the **Single Track** tab
2. Paste any YouTube video URL (even one copied from inside a playlist — only that one track downloads)
3. Click **Analyze**, then **Download Track**

Single tracks are saved to `downloads\` directly.

## File permissions (Windows)

On Windows, downloaded files are accessible without any permission changes. Docker Desktop runs containers in a Linux VM but mounts the `downloads` folder into your Windows filesystem via WSL 2 — files are readable by your user account automatically.

If a media player reports access errors, open **File Explorer**, right-click the `downloads` folder → **Properties** → **Security** → ensure your user has **Full control**.

## Cookie support (age-restricted content)

If you get "Sign in to confirm your age" or "Please sign in" errors:

1. Export your YouTube cookies from a browser using the [Get cookies.txt LOCALLY extension](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Save the file as `cookies.txt` in the project root (replace the empty one)
3. Restart the worker:

```bat
docker compose restart worker
```

The cookies file is mounted into the container at `/cookies/cookies.txt`.

## Stopping and restarting

```bat
:: Stop
docker compose down

:: Stop and delete the database (fresh start)
docker compose down -v

:: View logs
docker compose logs -f

:: View worker logs only
docker compose logs -f worker
```

## Troubleshooting (Windows)

**Docker Desktop not starting**
Ensure WSL 2 is enabled. Run in PowerShell as Administrator:

```powershell
wsl --install
wsl --set-default-version 2
```

Then restart Docker Desktop.

**Port 3000 already in use**
Another app is using port 3000. Either stop it or change the port in `docker-compose.yml`:

```yaml
frontend:
  ports:
    - "3001:80"   # change 3000 to any free port
```

**Antivirus blocking downloads**
Windows Defender or third-party antivirus may quarantine downloaded MP3 files. Add the `downloads` folder to your antivirus exclusion list.

## Project structure

```text
.
├── backend\          FastAPI + Celery worker
│   ├── main.py       API routes
│   ├── tasks.py      Download pipeline (yt-dlp)
│   ├── models.py     SQLAlchemy models
│   └── ...
├── frontend\         React + Vite + Tailwind UI
├── downloads\        Output directory (created on first run)
├── cookies.txt       YouTube session cookies (optional)
└── docker-compose.yml
```
