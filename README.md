# HarmonySync

Download YouTube playlists and individual tracks as high-quality MP3 files, with automatic metadata tagging, loudness normalization, and a full metadata editor.

## Features

### Downloading
- Download entire playlists, channels, or single tracks from YouTube
- Selectable bitrate: 128 / 192 / 256 / **320 kbps** (default)
- Upload local MP3 files from your drive and manage their metadata
- Tracks already on disk are detected and skipped (checks actual files, not just the database)
- Sync mode: only download new tracks added since last run
- Full re-download mode: re-archive every track from scratch
- Per-song progress bars with live status updates
- Cancel in-progress downloads; retry failed songs individually
- Cookie support for age-restricted or sign-in-required content

### Audio Processing
- **-14 LUFS loudness normalization** — two-pass EBU R128 via ffmpeg, applied automatically to every download so all songs play at a consistent volume
- **SponsorBlock** (opt-in) — strips intros, outros, self-promo, and off-topic segments using community-sourced data; toggle per download with a warning that results may not always be accurate
- **Manual audio trim** — cut out specific sections by timestamp (e.g. `0:00 → 0:08`) directly in the metadata editor; supports multiple cuts per song; permanent and cannot be undone

### Metadata
- **iTunes search** — search by title/artist, select the best match, apply cover art + full tags in one click
- **Spotify search** (optional) — same workflow; requires free Spotify API credentials configured in Settings
- Auto-tag on download — optionally run iTunes or Spotify search automatically during the download pipeline
- Manual editing — edit title, artist, album, year, genre fields directly
- Cover art — upload a custom image or pull it from a search result
- File rename — rename the MP3 file on disk from the editor; auto-fill from title/artist fields
- Bulk **Tag All** — run iTunes or Spotify search across all songs in a session at once
- Bulk **Rename All** — rename every song file to `Title - Artist.mp3` in one click
- Session and song history with live polling during active downloads

### UI
- Playlist, Single track, and Upload tabs
- Single-track Analyze shows song title preview before downloading
- Session URLs and per-song YouTube source links are clickable and open in a new tab
- Spotify integration settings panel (in the sidebar)

## Requirements

- **Windows:** [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) (includes Docker Compose)
- **Linux / macOS:** [Docker Engine](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/)

ffmpeg and all other dependencies are bundled inside the Docker image — nothing to install on the host.

## Quick start

### Windows (Command Prompt or PowerShell)

```bat
:: 1. Clone the repository
git clone <repo-url>
cd Download-music

:: 2. Create required directories and files
mkdir downloads
type nul > cookies.txt

:: 3. Start everything
docker compose up -d

:: 4. Open the UI
:: http://localhost:3000
```

### Linux / macOS

```bash
# 1. Clone the repository
git clone <repo-url>
cd Download-music

# 2. Create required directories and files
mkdir -p downloads
touch cookies.txt

# 3. Start everything
docker compose up -d

# 4. Open the UI
# http://localhost:3000
```

No environment variables or credentials required to get started.

## Downloading music

### Playlist or channel

1. Open `http://localhost:3000`
2. Paste a YouTube playlist or channel URL into the **Playlist** tab
3. Click **Analyze** — the app checks which tracks are already on disk and shows new vs. archived counts
4. Optionally set a session name, bitrate, and SponsorBlock toggle
5. Click **Sync N New Songs** (download only new tracks) or **Full Re-download** (re-archive everything)

Songs are saved to `downloads/<playlist name>/`.

### Single track

1. Switch to the **Single** tab
2. Paste any YouTube video URL (even one copied from inside a playlist — only that one track downloads)
3. Click **Analyze** — the song title is shown as a preview
4. Click **Download Track**

Single tracks are saved to `downloads/Singles - <date>/`.

### Upload local files

1. Switch to the **Upload** tab
2. Drag and drop MP3 files or click to browse
3. Click **Upload** — files are added to a session and their existing ID3 tags are read automatically
4. Use the metadata editor to search iTunes or Spotify and update tags

## Metadata editor

Click any song row in a session report to open the editor panel. From there you can:

- Edit title, artist, album, year, genre directly and **Save Metadata**
- Search **iTunes** or **Spotify** for a match — results are ranked by relevance; select one and click **Apply**
- Upload a custom cover art image by clicking the cover thumbnail
- **Rename File** — rename the MP3 on disk; use the auto-fill button to set `Title - Artist`
- **Trim Audio** — expand this section to cut out unwanted sections by timestamp range (e.g. remove a 30-second intro); multiple cuts supported; irreversible

## Spotify integration (optional)

iTunes search works out of the box with no setup. To also enable Spotify search:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app
2. Copy the **Client ID** and **Client Secret**
3. Open the sidebar in HarmonySync, expand **Spotify Integration**, and paste the credentials

Spotify requires a Spotify account but not a Premium subscription for metadata search.

## Loudness normalization

Every downloaded file is automatically normalized to **-14 LUFS** (the standard target used by Spotify and YouTube Music) using ffmpeg's two-pass EBU R128 `loudnorm` filter. This happens after download and after any SponsorBlock cuts. No configuration needed — ID3 tags and cover art are preserved through the process.

## SponsorBlock

When enabled (off by default), SponsorBlock queries the community database at [sponsor.ajay.app](https://sponsor.ajay.app) and removes matched segments (intros, outros, self-promo, interaction reminders, off-topic music) using ffmpeg. Enable the toggle in the confirm panel after clicking Analyze.

> **Warning:** SponsorBlock data is community-sourced and not always accurate. It may cut songs in unexpected places. Review trimmed files if audio quality is important.

## File permissions

### Windows

Files are accessible without changes. If a media player reports access errors, right-click the `downloads` folder → **Properties** → **Security** and ensure your user has **Full control**.

### Linux

Downloaded files are owned by `root` because containers run as root. If you get "Permission denied":

```bash
# Option 1 — change ownership to your user (recommended)
sudo chown -R $USER:$USER downloads/

# Option 2 — make files world-readable
sudo chmod -R 755 downloads/
```

Or run containers as your own user by adding to both `backend` and `worker` in `docker-compose.yml`:

```yaml
backend:
  user: "1000:1000"   # replace with your uid:gid  (run: id -u && id -g)
worker:
  user: "1000:1000"
```

> If using the `user:` option, ensure the `data` directory is owned by your user:
> ```bash
> mkdir -p data && sudo chown $USER:$USER data
> ```

## Cookie support (age-restricted content)

If you get "Sign in to confirm your age" or "Please sign in" errors:

1. Export YouTube cookies from a browser using the [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) extension
2. Save the file as `cookies.txt` in the project root (replace the empty placeholder)
3. Restart the worker:

```bash
docker compose restart worker
```

## Stopping and restarting

```bash
# Stop all containers
docker compose down

# Stop and delete the database (fresh start)
docker compose down -v

# View all logs
docker compose logs -f

# View worker logs only (download pipeline)
docker compose logs -f worker
```

## Troubleshooting

### Windows

**Docker Desktop not starting**
Ensure WSL 2 is enabled. Run in PowerShell as Administrator:
```powershell
wsl --install
wsl --set-default-version 2
```
Then restart Docker Desktop.

**Antivirus blocking downloads**
Windows Defender or third-party antivirus may quarantine downloaded MP3 files. Add the `downloads` folder to your antivirus exclusion list.

### Linux

**Permission denied when starting containers**
Add your user to the `docker` group:
```bash
sudo usermod -aG docker $USER
# Log out and back in for the change to take effect
```

**SQLite errors after changing volume mounts**
```bash
docker compose down -v
rm -f data/harmonysync.db
docker compose up -d
```

### Common (both platforms)

**Port 3000 already in use**
Change the port in `docker-compose.yml`:
```yaml
frontend:
  ports:
    - "3001:80"   # use any free port
```

## Project structure

```
.
├── backend/
│   ├── main.py         API routes (FastAPI)
│   ├── tasks.py        Download pipeline (yt-dlp + ffmpeg)
│   ├── metadata.py     iTunes / Spotify search and tag writing
│   ├── utils.py        Shared ffmpeg helpers (loudnorm, cut)
│   ├── models.py       SQLAlchemy models
│   ├── schemas.py      Pydantic request/response schemas
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/ React components (DownloadForm, Report, MetadataEditor, …)
│   │   └── api.ts      Typed API client
│   └── Dockerfile
├── downloads/          Output directory (created on first run)
├── cookies.txt         YouTube session cookies (optional)
└── docker-compose.yml
```
