import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchActiveSessions } from "../api";

type ActiveSession = {
  id: number;
  url: string;
  name: string | null;
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
            className="flex items-center gap-3 px-4 py-3 bg-emerald-950/50 border border-emerald-800/50 rounded-xl hover:bg-emerald-950/80 transition-colors group"
          >
            {/* Pulse dot */}
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-emerald-200 font-medium truncate">
                {s.name || shortenUrl(s.url)}
              </p>
              {/* Mini progress bar */}
              <div className="mt-1.5 h-1 bg-emerald-900/60 rounded-full overflow-hidden w-full">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Count + arrow */}
            <div className="shrink-0 text-right">
              <p className="text-xs text-emerald-400 font-medium tabular-nums">
                {s.in_progress} left
              </p>
              <p className="text-xs text-emerald-700 group-hover:text-emerald-500 transition-colors">
                View →
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
