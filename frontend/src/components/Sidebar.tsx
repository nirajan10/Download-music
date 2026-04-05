import { Link, useLocation } from "react-router-dom";
import { SessionList } from "./SessionList";

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 min-h-screen">
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-black tracking-tight">
          HS
        </div>
        <span className="font-bold text-white text-base tracking-tight">
          HarmonySync
        </span>
      </Link>

      {/* Primary nav */}
      <div className="px-3 py-3 border-b border-gray-800">
        <Link
          to="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            pathname === "/"
              ? "bg-indigo-600/20 text-indigo-300 border border-indigo-700/40"
              : "text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent"
          }`}
        >
          <span className="text-base leading-none">＋</span>
          New Download
        </Link>
      </div>

      {/* Past sessions */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <p className="px-5 pt-3 pb-1.5 text-xs font-semibold text-gray-600 uppercase tracking-widest">
          Past Sessions
        </p>
        <div className="flex-1 overflow-y-auto">
          <SessionList />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-800">
        <p className="text-xs text-gray-700">
          320 kbps · −14 LUFS · SponsorBlock
        </p>
      </div>
    </aside>
  );
}
