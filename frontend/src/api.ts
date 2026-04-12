import axios from "axios";
import type {
  DownloadRequest,
  PlaylistCheckResponse,
  Session,
  SongMetadata,
  SpotifyCandidate,
  ItunesCandidate,
} from "./types";

const http = axios.create({ baseURL: "/api" });

export const fetchSessions = (): Promise<Session[]> =>
  http.get<Session[]>("/sessions").then((r) => r.data);

export const fetchSession = (id: number): Promise<Session> =>
  http.get<Session>(`/sessions/${id}`).then((r) => r.data);

export const checkUrl = (req: DownloadRequest): Promise<PlaylistCheckResponse> =>
  http.post<PlaylistCheckResponse>("/check", req).then((r) => r.data);

export const startDownload = (
  req: DownloadRequest
): Promise<{ session_id: number; queued: number; mode: string }> =>
  http.post("/download", req).then((r) => r.data);

export const cancelSession = (id: number): Promise<{ cancelled: number }> =>
  http.post(`/sessions/${id}/cancel`).then((r) => r.data);

export const fetchActiveSessions = (): Promise<
  { id: number; url: string; in_progress: number; total: number }[]
> => http.get("/sessions/active").then((r) => r.data);

export const fetchReport = (
  id: number
): Promise<{
  session_id: number;
  url: string;
  last_synced_at: string;
  songs: {
    id: number;
    title: string | null;
    artist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    status: string;
    source_url: string | null;
    bitrate: number | null;
    metadata_source: string;
    error_message: string | null;
    progress: number;
    has_cover: boolean;
    spotify_id: string | null;
  }[];
}> => http.get(`/sessions/${id}/report`).then((r) => r.data);

// ── Metadata API ─────────────────────────────────────────────────────────────

export const fetchSongMetadata = (songId: number): Promise<SongMetadata> =>
  http.get<SongMetadata>(`/songs/${songId}/metadata`).then((r) => r.data);

export const updateSongMetadata = (
  songId: number,
  data: { title?: string; artist?: string; album?: string; year?: string; genre?: string }
): Promise<SongMetadata> =>
  http.put<SongMetadata>(`/songs/${songId}/metadata`, data).then((r) => r.data);

export const searchMetadata = (
  songId: number,
  query: { title?: string; artist?: string },
  source: "itunes" | "spotify" = "itunes"
): Promise<SpotifyCandidate[] | ItunesCandidate[]> =>
  http
    .post(`/songs/${songId}/metadata/fetch?source=${source}`, query)
    .then((r) => r.data);

// Keep old name as alias for backward compatibility
export const searchSpotify = (
  songId: number,
  query: { title?: string; artist?: string }
): Promise<SpotifyCandidate[]> =>
  searchMetadata(songId, query, "spotify") as Promise<SpotifyCandidate[]>;

export const applySpotifyMatch = (
  songId: number,
  data: {
    spotify_id: string;
    cover_url?: string;
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  }
): Promise<SongMetadata> =>
  http.post<SongMetadata>(`/songs/${songId}/metadata/apply`, data).then((r) => r.data);

export const applyItunesMatch = (
  songId: number,
  data: {
    itunes_id: number;
    cover_url?: string;
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  }
): Promise<SongMetadata> =>
  http.post<SongMetadata>(`/songs/${songId}/metadata/apply/itunes`, data).then((r) => r.data);

export const uploadCoverArt = (songId: number, file: File): Promise<{ cover_url: string }> => {
  const form = new FormData();
  form.append("file", file);
  return http.post(`/songs/${songId}/cover`, form).then((r) => r.data);
};

export const getCoverArtUrl = (songId: number): string => `/api/songs/${songId}/cover`;

// ── Spotify settings ──────────────────────────────────────────────────────────

export const fetchSpotifySettings = (): Promise<{ configured: boolean; client_id: string }> =>
  http.get("/settings/spotify").then((r) => r.data);

export const saveSpotifySettings = (
  client_id: string,
  client_secret: string,
): Promise<{ configured: boolean }> =>
  http.post("/settings/spotify", { client_id, client_secret }).then((r) => r.data);

export const clearSpotifySettings = (): Promise<{ configured: boolean }> =>
  http.delete("/settings/spotify").then((r) => r.data);

export const retrySong = (songId: number): Promise<{ song_id: number; status: string }> =>
  http.post(`/songs/${songId}/retry`).then((r) => r.data);

export const tagAllSongs = (
  sessionId: number,
  source: "itunes" | "spotify"
): Promise<{ queued: number; source: string }> =>
  http.post(`/sessions/${sessionId}/tag-all?source=${source}`).then((r) => r.data);

export const renameSong = (
  songId: number,
  newName: string
): Promise<{ filename: string; file_path: string }> =>
  http.post(`/songs/${songId}/rename`, { new_name: newName }).then((r) => r.data);
