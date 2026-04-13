import { Link, useLocation } from "react-router-dom";
import { SessionList } from "./SessionList";

function MusicNoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800 min-h-screen">
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center gap-3 px-4 py-5 border-b border-zinc-800/80 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-emerald-500/20">
          <MusicNoteIcon />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-white text-sm tracking-tight leading-none">HarmonySync</p>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-none">Music Downloader</p>
        </div>
      </Link>

      {/* Primary nav */}
      <div className="px-2 py-2.5 border-b border-zinc-800/60">
        <Link
          to="/"
          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
            isHome
              ? "bg-emerald-500/15 text-emerald-400 shadow-sm"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70"
          }`}
        >
          <span className={isHome ? "text-emerald-400" : "text-zinc-500"}>
            <PlusIcon />
          </span>
          New Download
        </Link>
      </div>

      {/* Past sessions */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <SessionList />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 tracking-wide leading-relaxed">
          320 kbps · −14 LUFS · SponsorBlock
        </p>
      </div>
    </aside>
  );
}
