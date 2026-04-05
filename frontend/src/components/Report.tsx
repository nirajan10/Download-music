import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cancelSession, fetchReport } from "../api";

type SongRow = {
  id: number;
  title: string | null;
  status: string;
  source_url: string | null;
  bitrate: number | null;
  metadata_source: string;
  error_message: string | null;
  progress: number;
};

type ReportData = {
  session_id: number;
  url: string;
  last_synced_at: string;
  songs: SongRow[];
};

const IN_PROGRESS = new Set(["pending", "downloading", "tagging"]);

const STATUS_PILL: Record<string, { label: string; classes: string; pulse?: boolean }> = {
  done:        { label: "Done",        classes: "bg-emerald-950 border-emerald-800 text-emerald-400" },
  failed:      { label: "Failed",      classes: "bg-red-950 border-red-800 text-red-400" },
  cancelled:   { label: "Cancelled",   classes: "bg-gray-800 border-gray-600 text-gray-500" },
  downloading: { label: "Downloading", classes: "bg-blue-950 border-blue-800 text-blue-300", pulse: true },
  tagging:     { label: "Tagging",     classes: "bg-purple-950 border-purple-800 text-purple-300", pulse: true },
  pending:     { label: "Pending",     classes: "bg-gray-800 border-gray-700 text-gray-400" },
};

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
                          "bg-indigo-500";

  const textColor =
    status === "done"   ? "text-emerald-400" :
    status === "failed" ? "text-red-400"     :
                          "text-indigo-400";

  if (status === "pending" && progress === 0) {
    return <span className="text-gray-700 text-xs">—</span>;
  }

  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const result = await fetchReport(Number(id));
      setData(result);
      // Stop polling once every song is terminal
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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [id]);

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

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-800 shrink-0">
        <div className="flex items-start justify-between gap-6 mb-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white mb-1">Session Report</h1>
            <p className="text-xs text-gray-500 break-all leading-relaxed">{data.url}</p>
            <p className="text-xs text-gray-600 mt-1">
              Last synced:{" "}
              {new Date(data.last_synced_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {/* Cancel controls — only shown while downloads are active */}
            {!allFinished && (
              confirmCancel ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/60 border border-red-800 rounded-lg">
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
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="px-3 py-1.5 bg-red-950/40 hover:bg-red-950/80 border border-red-900 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )
            )}

            {/* Done / Back */}
            {allFinished ? (
              <button
                onClick={() => navigate("/")}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <span>✓</span> Done
              </button>
            ) : (
              <Link
                to="/"
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-lg transition-colors"
              >
                ← Back
              </Link>
            )}
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-700"
            style={{ width: `${overallPct}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-emerald-400 font-medium">{done} done</span>
          <span className="text-gray-600">·</span>
          <span className="text-red-400 font-medium">{failed} failed</span>
          <span className="text-gray-600">·</span>
          <span className="text-yellow-400 font-medium">{active} in progress</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-500">{total} total</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="rounded-2xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium w-full">Song Title</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Progress</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Source</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Metadata</th>
                <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Bitrate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {data.songs.map((song) => (
                <tr key={song.id} className="hover:bg-gray-800/30 transition-colors">
                  {/* Title */}
                  <td className="px-4 py-3 max-w-xs">
                    <span className="block truncate text-gray-100" title={song.title ?? ""}>
                      {song.title ?? <span className="text-gray-600 italic">No title yet</span>}
                    </span>
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

                  {/* Source link */}
                  <td className="px-4 py-3">
                    {song.source_url ? (
                      <a
                        href={song.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 text-xs underline underline-offset-2"
                      >
                        YouTube ↗
                      </a>
                    ) : (
                      <span className="text-gray-700 text-xs">—</span>
                    )}
                  </td>

                  {/* Metadata source */}
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${song.metadata_source === "spotify" ? "text-emerald-400" : "text-gray-500"}`}>
                      {song.metadata_source === "spotify" ? "● Spotify" : "○ YouTube"}
                    </span>
                  </td>

                  {/* Bitrate */}
                  <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">
                    {song.bitrate ? `${song.bitrate} kbps` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
