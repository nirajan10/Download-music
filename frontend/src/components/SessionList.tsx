import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { deleteAllSessions, deleteSession, fetchSessions, renameSession } from "../api";
import type { Session } from "../types";

function SkeletonRow() {
  return (
    <div className="mx-2 mb-1 h-14 rounded-lg bg-zinc-800/60 animate-pulse" />
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateUrl(url: string, max = 34) {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    const list = searchParams.get("list");
    const label = list
      ? `${hostname}/…?list=${list.slice(0, 10)}…`
      : `${hostname}${pathname}`.slice(0, max);
    return label.length > max ? label.slice(0, max) + "…" : label;
  } catch {
    return url.slice(0, max) + (url.length > max ? "…" : "");
  }
}

export function SessionList() {
  const { pathname } = useLocation();
  const activeId = pathname.startsWith("/session/") ? pathname.split("/")[2] : undefined;
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () =>
    fetchSessions()
      .then((data) => {
        setSessions(data);
        const anyActive = data.some((s) =>
          s.songs?.some((song) =>
            ["pending", "downloading", "normalizing", "tagging"].includes(song.status)
          )
        );
        if (anyActive && !intervalRef.current) {
          intervalRef.current = setInterval(load, 3000);
        } else if (!anyActive && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleDelete = async (sessionId: number) => {
    setDeleting(true);
    try {
      await deleteSession(sessionId);
      if (String(sessionId) === activeId) navigate("/");
      await load();
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const handleClearAll = async () => {
    setDeleting(true);
    try {
      await deleteAllSessions();
      setSessions([]);
      if (activeId) navigate("/");
    } finally {
      setDeleting(false);
      setConfirmClearAll(false);
    }
  };

  const startRename = (session: Session) => {
    setPendingDeleteId(null);
    setRenamingId(session.id);
    setRenameValue(session.name ?? "");
  };

  const commitRename = async (sessionId: number) => {
    const trimmed = renameValue.trim();
    try {
      const result = await renameSession(sessionId, trimmed);
      setSessions((prev) =>
        prev.map((s) => s.id === sessionId ? { ...s, name: result.name } : s)
      );
    } catch {
      // ignore
    } finally {
      setRenamingId(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
          Sessions
        </p>
        {sessions.length > 0 && !confirmClearAll && (
          <button
            onClick={() => setConfirmClearAll(true)}
            className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Clear-all confirm */}
      {confirmClearAll && (
        <div className="mx-2 mb-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg flex items-center gap-2">
          <span className="text-xs text-zinc-400 flex-1">Clear all history?</span>
          <button
            onClick={handleClearAll}
            disabled={deleting}
            className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {deleting ? "…" : "Yes"}
          </button>
          <span className="text-zinc-700 text-xs">|</span>
          <button
            onClick={() => setConfirmClearAll(false)}
            disabled={deleting}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            No
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="pt-2">
            {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-4 pt-5 text-xs text-zinc-600 text-center leading-relaxed">
            No sessions yet.
            <br />
            Paste a URL above to begin.
          </p>
        ) : (
          <nav className="flex flex-col gap-0.5 px-2 py-1">
            {sessions.map((session) => {
              const isActive = String(session.id) === activeId;
              const inProgress = session.songs?.some((s) =>
                ["pending", "downloading", "normalizing", "tagging"].includes(s.status)
              );
              const isPendingDelete = pendingDeleteId === session.id;
              const isRenaming = renamingId === session.id;
              const displayName = session.name || truncateUrl(session.url);

              if (isRenaming) {
                return (
                  <div
                    key={session.id}
                    className={`rounded-lg px-3 py-2 border ${
                      isActive
                        ? "bg-emerald-500/10 border-emerald-700/30"
                        : "bg-zinc-800 border-zinc-700"
                    }`}
                  >
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(session.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(session.id)}
                      placeholder="Session name…"
                      className="w-full bg-transparent text-sm text-white placeholder-zinc-600 focus:outline-none"
                    />
                    <p className="text-xs text-zinc-600 mt-0.5">Enter to save · Esc to cancel</p>
                  </div>
                );
              }

              if (isPendingDelete) {
                return (
                  <div
                    key={session.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border ${
                      isActive
                        ? "bg-emerald-500/10 border-emerald-700/30"
                        : "bg-zinc-800 border-zinc-700"
                    }`}
                  >
                    <span className="text-xs text-zinc-400 flex-1 truncate">
                      Remove from history?
                    </span>
                    <button
                      onClick={() => handleDelete(session.id)}
                      disabled={deleting}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 shrink-0"
                    >
                      {deleting ? "…" : "Yes"}
                    </button>
                    <span className="text-zinc-700 text-xs">|</span>
                    <button
                      onClick={() => setPendingDeleteId(null)}
                      disabled={deleting}
                      className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0"
                    >
                      No
                    </button>
                  </div>
                );
              }

              return (
                <div key={session.id} className="relative group">
                  <Link
                    to={`/session/${session.id}`}
                    className={`flex flex-col rounded-lg px-3 py-2.5 pr-14 transition-colors ${
                      isActive
                        ? "bg-emerald-500/15 border border-emerald-500/25"
                        : "hover:bg-zinc-800/70 border border-transparent"
                    }`}
                  >
                    <span
                      className={`text-sm font-medium truncate leading-snug ${
                        isActive ? "text-emerald-300" : "text-zinc-200 group-hover:text-white"
                      }`}
                    >
                      {displayName}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs font-semibold ${
                          isActive ? "text-emerald-500" : "text-emerald-600"
                        }`}
                      >
                        {session.total_songs} done
                      </span>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-xs text-zinc-600">
                        {formatDate(session.last_synced_at)}
                      </span>
                      {inProgress && (
                        <>
                          <span className="text-zinc-700 text-xs">·</span>
                          <span className="flex items-center gap-1 text-xs text-yellow-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                            syncing
                          </span>
                        </>
                      )}
                    </div>
                  </Link>

                  {/* Action buttons — revealed on hover */}
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all">
                    {/* Rename */}
                    <button
                      onClick={(e) => { e.preventDefault(); startRename(session); }}
                      title="Rename"
                      className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-emerald-400 transition-colors rounded"
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/>
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setPendingDeleteId(session.id);
                        setConfirmClearAll(false);
                      }}
                      title="Remove from history"
                      className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors rounded"
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <line x1="1" y1="1" x2="7" y2="7" />
                        <line x1="7" y1="1" x2="1" y2="7" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
