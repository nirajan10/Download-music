import axios from "axios";
import type {
  DownloadRequest,
  PlaylistCheckResponse,
  Session,
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
    status: string;
    source_url: string | null;
    bitrate: number | null;
    metadata_source: string;
    error_message: string | null;
    progress: number;
  }[];
}> => http.get(`/sessions/${id}/report`).then((r) => r.data);
