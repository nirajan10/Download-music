import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cancelSession, fetchReport, retrySong, tagAllSongs, renameAllSongs, fetchSpotifySettings } from "../api";
import { MetadataEditor } from "./MetadataEditor";

type SongRow = {
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
  itunes_id: number | null;
  sponsorblock_removed_s: number | null;
};

type ReportData = {
  session_id: number;
  url: string;
  last_synced_at: string;
  songs: SongRow[];
};

const IN_PROGRESS = new Set(["pending", "downloading", "tagging"]);

function formatEta(secs: number): string {
  if (secs < 60) return `~${secs}s left`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s > 0 ? `~${m}m ${s}s left` : `~${m}m left`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `~${h}h ${rm}m left`;
}

const STATUS_PILL: Record<string, { label: string; classes: string; pulse?: boolean }> = {
  done:        { label: "Done",        classes: "bg-emerald-950 border-emerald-800/60 text-emerald-400" },
  failed:      { label: "Failed",      classes: "bg-red-950 border-red-800/60 text-red-400" },
  cancelled:   { label: "Cancelled",   classes: "bg-zinc-800 border-zinc-700 text-zinc-500" },
  downloading: { label: "Downloading", classes: "bg-blue-950 border-blue-800/60 text-blue-300", pulse: true },
  tagging:     { label: "Tagging",     classes: "bg-purple-950 border-purple-800/60 text-purple-300", pulse: true },
  pending:     { label: "Pending",     classes: "bg-zinc-800 border-zinc-700 text-zinc-400" },
};

const META_DISPLAY: Record<string, { label: string; color: string }> = {
  spotify:     { label: "Spotify",     color: "text-emerald-400" },
  itunes:      { label: "iTunes",      color: "text-pink-400" },
  ytmusic:     { label: "YT Music",    color: "text-red-400" },
  manual:      { label: "Manual",      color: "text-cyan-400" },
  youtube:     { label: "YouTube",     color: "text-zinc-500" },
};

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="relative group inline-flex items-center">
      <div className="w-4 h-4 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-[10px] font-bold flex items-center justify-center cursor-default transition-colors select-none">
        i
      </div>
      <div className="absolute top-full right-0 mt-2 w-64 px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-zinc-300 leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none z-50 shadow-xl transition-opacity">
        <div className="absolute bottom-full right-1.5 border-4 border-transparent border-b-zinc-700" />
        {text}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? STATUS_PILL.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${cfg.classes}`}>
      {cfg.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {cfg.label}
    </span>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: string }) {
  const barColor =
    status === "done"   ? "bg-emerald-500" :
    status === "failed" ? "bg-red-500"     :
                          "bg-emerald-500";

  const textColor =
    status === "done"   ? "text-emerald-400" :
    status === "failed" ? "text-red-400"     :
                          "text-emerald-400";

  if (status === "pending" && progress === 0) {
    return <span className="text-zinc-700 text-xs">—</span>;
  }

  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums w-8 text-right ${textColor}`}>
        {progress}%
      </span>
    </div>
  );
}

export function Report() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editSongId, setEditSongId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [confirmTagAll, setConfirmTagAll] = useState(false);
  const [tagSource, setTagSource] = useState<"itunes" | "spotify">("itunes");
  const [taggingAll, setTaggingAll] = useState(false);
  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [confirmRenameAll, setConfirmRenameAll] = useState(false);
  const [renamingAll, setRenamingAll] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const initialDoneRef = useRef<number | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const result = await fetchReport(Number(id));
      setData(result);
      const allDone = result.songs.every((s: SongRow) => !IN_PROGRESS.has(s.status));
      if (allDone && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 2000);
    fetchSpotifySettings().then((s) => setSpotifyConfigured(s.configured)).catch(() => {});
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const activeCount = data.songs.filter((s) => IN_PROGRESS.has(s.status)).length;
    const doneCount   = data.songs.filter((s) => s.status === "done").length;
    if (activeCount > 0 && startTimeRef.current === null) {
      startTimeRef.current  = Date.now();
      initialDoneRef.current = doneCount;
    }
    if (activeCount === 0) {
      startTimeRef.current  = null;
      initialDoneRef.current = null;
    }
  }, [data]);

  const handleCancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await cancelSession(Number(id));
      setConfirmCancel(false);
      await load();
    } finally {
      setCancelling(false);
    }
  };

  const handleTagAll = async () => {
    if (!id) return;
    setTaggingAll(true);
    try {
      await tagAllSongs(Number(id), tagSource);
      setConfirmTagAll(false);
      await load();
      if (!intervalRef.current) {
        intervalRef.current = setInterval(load, 2000);
      }
    } finally {
      setTaggingAll(false);
    }
  };

  const handleRenameAll = async () => {
    if (!id) return;
    setRenamingAll(true);
    try {
      await renameAllSongs(Number(id));
      setConfirmRenameAll(false);
      await load();
    } finally {
      setRenamingAll(false);
    }
  };

  const handleRetry = async (songId: number) => {
    setRetrying((prev) => new Set(prev).add(songId));
    try {
      await retrySong(songId);
      await load();
      if (!intervalRef.current) {
        intervalRef.current = setInterval(load, 2000);
      }
    } finally {
      setRetrying((prev) => { const s = new Set(prev); s.delete(songId); return s; });
    }
  };

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="flex-1 flex items-center justify-center text-red-400">Session not found.</div>;
  }

  const done    = data.songs.filter((s) => s.status === "done").length;
  const failed  = data.songs.filter((s) => s.status === "failed").length;
  const active  = data.songs.filter((s) => IN_PROGRESS.has(s.status)).length;
  const total   = data.songs.length;
  const allFinished = total > 0 && active === 0;
  const overallPct  = total > 0 ? Math.round((done / total) * 100) : 0;

  let etaText: string | null = null;
  if (active > 0 && startTimeRef.current !== null && initialDoneRef.current !== null) {
    const elapsed   = (Date.now() - startTimeRef.current) / 1000;
    const newlyDone = done - initialDoneRef.current;
    if (newlyDone > 0 && elapsed > 3) {
      const rate    = newlyDone / elapsed;
      const etaSecs = Math.ceil(active / rate);
      etaText = formatEta(etaSecs);
    } else {
      etaText = "Estimating…";
    }
  }

  const editSong = data.songs.find((s) => s.id === editSongId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-zinc-800 shrink-0 bg-zinc-950/50">
        {/* Breadcrumb + actions row */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Sessions
            </Link>
            <span className="text-zinc-700 text-sm">/</span>
            <h1 className="text-base font-semibold text-white truncate">Session Report</h1>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {!allFinished && (
              confirmCancel ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/60 border border-red-800/60 rounded-lg">
                  <span className="text-xs text-red-300">Cancel all?</span>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {cancelling ? "…" : "Yes"}
                  </button>
                  <span className="text-red-800">|</span>
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="px-3 py-1.5 bg-red-950/40 hover:bg-red-950/80 border border-red-900/60 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )
            )}

            {allFinished && done > 0 && (
              <button
                onClick={() => setConfirmTagAll(true)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium rounded-lg transition-colors"
              >
                Tag All
              </button>
            )}

            {allFinished && done > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setConfirmRenameAll(true)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Rename All
                </button>
                <InfoTooltip text="Renames every song file to 'Title - Artist.mp3'. Songs with only a title become 'Title.mp3'. Songs missing both title and artist are left unchanged." />
              </div>
            )}

            {allFinished ? (
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-900/30"
              >
                <span>✓</span> Done
              </button>
            ) : null}
          </div>
        </div>

        {/* URL + date */}
        <div className="mb-4">
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-600 hover:text-emerald-400 break-all leading-relaxed transition-colors"
          >
            {data.url}
          </a>
          <p className="text-xs text-zinc-700 mt-0.5">
            Last synced:{" "}
            {new Date(data.last_synced_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>

        {/* Overall progress bar */}
        <div className="w-full bg-zinc-800 rounded-full h-2 mb-3 overflow-hidden">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-700"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-emerald-400 font-medium">{done} done</span>
          <span className="text-zinc-700">·</span>
          <span className="text-red-400 font-medium">{failed} failed</span>
          <span className="text-zinc-700">·</span>
          <span className="text-yellow-400 font-medium">{active} in progress</span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500">{total} total</span>
          {etaText && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="text-emerald-400 font-medium">{etaText}</span>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="rounded-2xl border border-zinc-800 overflow-hidden shadow-xl shadow-black/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900 text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="text-left px-4 py-3 font-medium w-full">Song</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Progress</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Metadata</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Tags</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Bitrate</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {data.songs.map((song) => {
                const isDone = song.status === "done";
                const metaInfo = META_DISPLAY[song.metadata_source] ?? META_DISPLAY.youtube;
                return (
                  <tr
                    key={song.id}
                    className={`transition-colors ${isDone ? "hover:bg-zinc-800/40 cursor-pointer" : "hover:bg-zinc-800/20"}`}
                    onClick={() => isDone && setEditSongId(song.id)}
                  >
                    {/* Title + artist */}
                    <td className="px-4 py-3 max-w-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-zinc-100" title={song.title ?? ""}>
                          {song.title ?? <span className="text-zinc-600 italic">No title yet</span>}
                        </span>
                        {song.source_url && (
                          <a
                            href={song.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open source video"
                            className="shrink-0 text-zinc-700 hover:text-emerald-400 transition-colors"
                          >
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" />
                              <path d="M8 1h3v3" /><line x1="11" y1="1" x2="5.5" y2="6.5" />
                            </svg>
                          </a>
                        )}
                      </div>
                      {song.artist && (
                        <span className="block text-xs text-zinc-500 truncate">{song.artist}</span>
                      )}
                      {song.sponsorblock_removed_s != null && song.sponsorblock_removed_s > 0 && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-amber-950/50 border border-amber-800/40 text-amber-400 rounded text-[10px] font-medium">
                          SponsorBlock −{song.sponsorblock_removed_s < 60
                            ? `${Math.round(song.sponsorblock_removed_s)}s`
                            : `${Math.floor(song.sponsorblock_removed_s / 60)}m ${Math.round(song.sponsorblock_removed_s % 60)}s`}
                        </span>
                      )}
                      {song.error_message && (
                        <span className="block text-xs text-red-400 mt-0.5 truncate">
                          {song.error_message}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusPill status={song.status} />
                    </td>

                    {/* Progress bar */}
                    <td className="px-4 py-3">
                      <ProgressBar progress={song.progress} status={song.status} />
                    </td>

                    {/* Metadata source */}
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${metaInfo.color}`}>
                        {metaInfo.label}
                      </span>
                    </td>

                    {/* Tags indicator */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {song.has_cover && (
                          <span className="text-xs text-emerald-500" title="Has cover art">🖼</span>
                        )}
                        {song.album && (
                          <span className="text-xs text-zinc-500" title={`Album: ${song.album}`}>💿</span>
                        )}
                        {!song.has_cover && !song.album && (
                          <span className="text-zinc-700 text-xs">—</span>
                        )}
                      </div>
                    </td>

                    {/* Bitrate */}
                    <td className="px-4 py-3 text-xs text-zinc-500 tabular-nums">
                      {song.bitrate ? `${song.bitrate} kbps` : "—"}
                    </td>

                    {/* Edit / Retry button */}
                    <td className="px-4 py-3">
                      {isDone && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditSongId(song.id); }}
                          className="text-xs text-emerald-500 hover:text-emerald-400 font-medium whitespace-nowrap"
                        >
                          Edit
                        </button>
                      )}
                      {(song.status === "failed" || song.status === "cancelled") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(song.id); }}
                          disabled={retrying.has(song.id)}
                          className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-40 font-medium whitespace-nowrap"
                        >
                          {retrying.has(song.id) ? "…" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Metadata Editor slide-over */}
      {editSongId !== null && editSong && (
        <MetadataEditor
          songId={editSongId}
          songTitle={editSong.title}
          onClose={() => setEditSongId(null)}
          onSaved={() => load()}
        />
      )}

      {/* Rename All confirmation modal */}
      {confirmRenameAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !renamingAll && setConfirmRenameAll(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl shadow-black/40">
            <h3 className="text-white font-semibold text-base mb-1">Rename All Songs?</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-1">
              All <span className="text-white font-medium">{done}</span> downloaded song{done !== 1 ? "s" : ""} will be
              renamed to <span className="text-zinc-300 font-mono text-xs bg-zinc-800 px-1.5 py-0.5 rounded">Title - Artist.mp3</span>.
            </p>
            <p className="text-xs text-zinc-600 leading-relaxed mb-5">
              Songs with only a title become <span className="font-mono">Title.mp3</span>.
              Songs missing both are left unchanged. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRenameAll(false)}
                disabled={renamingAll}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-300 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameAll}
                disabled={renamingAll}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {renamingAll ? "Renaming…" : `Rename All (${done})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag All confirmation modal */}
      {confirmTagAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !taggingAll && setConfirmTagAll(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl shadow-black/40">
            <h3 className="text-white font-semibold text-base mb-1">Tag All Songs?</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              This will search metadata for all{" "}
              <span className="text-white font-medium">{done}</span> downloaded song{done !== 1 ? "s" : ""} and
              overwrite any existing tags. Results may not always be perfect —
              review each song's metadata afterwards.
            </p>

            {/* Source selector */}
            {spotifyConfigured && (
              <div className="flex gap-1 p-1 bg-zinc-800 rounded-lg border border-zinc-700/60 mb-4">
                {(["itunes", "spotify"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setTagSource(src)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                      tagSource === src
                        ? "bg-emerald-600 text-white shadow"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {src === "itunes" ? "iTunes" : "Spotify"}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setConfirmTagAll(false)}
                disabled={taggingAll}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-300 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTagAll}
                disabled={taggingAll}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {taggingAll ? "Queuing…" : `Tag All (${done})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
