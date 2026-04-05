import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchActiveSessions } from "../api";

type ActiveSession = {
  id: number;
  url: string;
  in_progress: number;
  total: number;
};

function shortenUrl(url: string): string {
  try {
    const { hostname, searchParams } = new URL(url);
    const list = searchParams.get("list");
    const v = searchParams.get("v");
    if (list) return `${hostname} — playlist`;
    if (v) return `${hostname}/watch?v=${v.slice(0, 8)}…`;
    return hostname;
  } catch {
    return url.slice(0, 48);
  }
}

export function ActiveSessionsBanner() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);

  useEffect(() => {
    const load = () => fetchActiveSessions().then(setSessions).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  if (sessions.length === 0) return null;

  return (
    <div className="w-full max-w-xl mb-6 space-y-2">
      {sessions.map((s) => {
        const pct = s.total > 0 ? Math.round(((s.total - s.in_progress) / s.total) * 100) : 0;
        return (
          <Link
            key={s.id}
            to={`/session/${s.id}`}
            className="flex items-center gap-3 px-4 py-3 bg-indigo-950/60 border border-indigo-800/60 rounded-xl hover:bg-indigo-950/90 transition-colors group"
          >
            {/* Pulse dot */}
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0" />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-indigo-200 font-medium truncate">
                {shortenUrl(s.url)}
              </p>
              {/* Mini progress bar */}
              <div className="mt-1.5 h-1 bg-indigo-900 rounded-full overflow-hidden w-full">
                <div
                  className="h-full bg-indigo-400 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Count + arrow */}
            <div className="shrink-0 text-right">
              <p className="text-xs text-indigo-400 font-medium tabular-nums">
                {s.in_progress} left
              </p>
              <p className="text-xs text-indigo-600 group-hover:text-indigo-400 transition-colors">
                View →
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
