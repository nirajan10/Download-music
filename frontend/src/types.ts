export type SongStatus =
  | "pending"
  | "downloading"
  | "tagging"
  | "done"
  | "failed"
  | "cancelled"
  | "tag_failed";

export type MetadataSource = "youtube" | "ytmusic" | "spotify" | "itunes" | "manual";

export interface Song {
  id: number;
  youtube_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  file_path: string | null;
  status: SongStatus;
  metadata_source: MetadataSource;
  bitrate: number | null;
  source_url: string | null;
  error_message: string | null;
  progress: number;
  has_cover: boolean;
  spotify_id: string | null;
  itunes_id: number | null;
}

export interface Session {
  id: number;
  url: string;
  url_hash: string;
  playlist_id: string | null;
  last_synced_at: string;
  total_songs: number;
  name: string | null;
  songs: Song[];
}

export interface CheckedTrack {
  youtube_id: string;
  title: string;
  existing: boolean;
}

export interface PlaylistCheckResponse {
  session_id: number | null;
  url_hash: string;
  new_songs: number;
  existing_songs: number;
  is_new_session: boolean;
  playlist_title: string | null;
  existing_folder: string | null;
  tracks: CheckedTrack[];
}

export interface DownloadRequest {
  url: string;
  mode: "sync" | "full" | "single";
  auto_metadata?: boolean;
  auto_metadata_source?: "itunes" | "spotify";
  quality?: number;
  name?: string;
  folder_override?: string;
  sponsorblock?: boolean;
}

export interface SongMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  cover_url: string | null;
  metadata_source: MetadataSource;
  spotify_id: string | null;
  itunes_id: number | null;
  filename: string | null;
}

export interface SpotifyCandidate {
  spotify_id: string;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  genre: string | null;
  cover_url: string | null;
  score: number;
}

export interface ItunesCandidate {
  itunes_id: number;
  title: string;
  artist: string;
  album: string | null;
  year: string | null;
  genre: string | null;
  cover_url: string | null;
  score: number;
}

export type MetadataCandidate =
  | (SpotifyCandidate & { source: "spotify" })
  | (ItunesCandidate & { source: "itunes" });
