export type SongStatus =
  | "pending"
  | "downloading"
  | "tagging"
  | "done"
  | "failed"
  | "cancelled";

export type MetadataSource = "spotify" | "youtube";

export interface Song {
  id: number;
  youtube_id: string;
  title: string | null;
  artist: string | null;
  file_path: string | null;
  status: SongStatus;
  metadata_source: MetadataSource;
  bitrate: number | null;
  source_url: string | null;
  error_message: string | null;
  progress: number;
}

export interface Session {
  id: number;
  url: string;
  url_hash: string;
  playlist_id: string | null;
  last_synced_at: string;
  total_songs: number;
  songs: Song[];
}

export interface PlaylistCheckResponse {
  session_id: number | null;
  url_hash: string;
  new_songs: number;
  existing_songs: number;
  is_new_session: boolean;
}

export interface DownloadRequest {
  url: string;
  mode: "sync" | "full";
}
