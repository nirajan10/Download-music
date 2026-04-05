import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchSessions } from "../api";
import type { Session } from "../types";

function SkeletonRow() {
  return (
    <div className="mx-2 mb-1 h-14 rounded-lg bg-gray-800 animate-pulse" />
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateUrl(url: string, max = 38) {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    const list = searchParams.get("list");
    const label = list
      ? `${hostname}/…?list=${list.slice(0, 12)}…`
      : `${hostname}${pathname}`.slice(0, max);
    return label.length > max ? label.slice(0, max) + "…" : label;
  } catch {
    return url.slice(0, max) + (url.length > max ? "…" : "");
  }
}

export function SessionList() {
  const { id: activeId } = useParams<{ id?: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="pt-2">
        {[...Array(5)].map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="px-4 pt-4 text-xs text-gray-500 text-center leading-relaxed">
        No sessions yet.
        <br />
        Paste a URL above to begin.
      </p>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-1">
      {sessions.map((session) => {
        const isActive = String(session.id) === activeId;
        const inProgress = session.songs?.some((s) =>
          ["pending", "downloading", "normalizing", "tagging"].includes(s.status)
        );

        return (
          <Link
            key={session.id}
            to={`/session/${session.id}`}
            className={`group flex flex-col rounded-lg px-3 py-2.5 transition-colors ${
              isActive
                ? "bg-indigo-600/25 border border-indigo-600/40"
                : "hover:bg-gray-800 border border-transparent"
            }`}
          >
            {/* URL label */}
            <span
              className={`text-sm font-medium truncate ${
                isActive ? "text-indigo-200" : "text-gray-200 group-hover:text-white"
              }`}
            >
              {truncateUrl(session.url)}
            </span>

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`text-xs font-semibold ${
                  isActive ? "text-indigo-400" : "text-indigo-500"
                }`}
              >
                {session.total_songs} done
              </span>
              <span className="text-gray-600 text-xs">·</span>
              <span className="text-xs text-gray-500">
                {formatDate(session.last_synced_at)}
              </span>
              {/* Live pulse when worker is active */}
              {inProgress && (
                <>
                  <span className="text-gray-600 text-xs">·</span>
                  <span className="flex items-center gap-1 text-xs text-yellow-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                    syncing
                  </span>
                </>
              )}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
