import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkUrl, startDownload } from "../api";
import type { PlaylistCheckResponse } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "playlist" | "single";
type Step = "idle" | "checking" | "confirm" | "starting" | "error";

// ── Small helpers ─────────────────────────────────────────────────────────────

function Spinner({ small }: { small?: boolean }) {
  const sz = small ? "w-3.5 h-3.5" : "w-5 h-5";
  return (
    <span className={`inline-block ${sz} border-2 border-current border-t-transparent rounded-full animate-spin`} />
  );
}

function StatBox({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex-1 bg-gray-900/60 rounded-xl px-4 py-3 border border-gray-700/50">
      <div className={`text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function ModeButton({
  label, sub, primary, disabled, onClick,
}: {
  label: string; sub: string; primary?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl border font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        primary
          ? "bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white"
          : "bg-gray-900/60 hover:bg-gray-800 border-gray-700 text-gray-300"
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className={`text-xs ${primary ? "text-indigo-200" : "text-gray-500"}`}>{sub}</span>
    </button>
  );
}

// ── Playlist tab ──────────────────────────────────────────────────────────────

function PlaylistTab() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [check, setCheck] = useState<PlaylistCheckResponse | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const busy = step === "checking" || step === "starting";

  const handleAnalyze = async () => {
    if (!url.trim() || busy) return;
    setErrMsg("");
    setCheck(null);
    setStep("checking");
    try {
      const result = await checkUrl({ url, mode: "sync" });
      setCheck(result);
      setStep("confirm");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Could not reach the server.";
      setErrMsg(msg);
      setStep("error");
    }
  };

  const handleDownload = async (mode: "sync" | "full") => {
    setStep("starting");
    try {
      const result = await startDownload({ url, mode });
      navigate(`/session/${result.session_id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Failed to start download.";
      setErrMsg(msg);
      setStep("error");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Paste a YouTube playlist or channel URL. HarmonySync will compare it against your
        archive and let you choose what to download.
      </p>

      {/* URL row */}
      <div className="flex gap-2.5">
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setStep("idle"); setCheck(null); setErrMsg(""); }}
          onKeyDown={(e) => e.key === "Enter" && step === "idle" && handleAnalyze()}
          placeholder="https://youtube.com/playlist?list=…"
          disabled={busy}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleAnalyze}
          disabled={!url.trim() || busy}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {step === "checking" ? <><Spinner small /> Checking</> : "Analyze"}
        </button>
      </div>

      {/* Error */}
      {step === "error" && errMsg && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setStep("idle")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Confirm panel */}
      {step === "confirm" && check && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-5 space-y-5">
          <div>
            {check.is_new_session ? (
              <span className="px-2.5 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-full text-xs font-medium">
                New playlist
              </span>
            ) : (
              <span className="px-2.5 py-0.5 bg-blue-950 border border-blue-800 text-blue-400 rounded-full text-xs font-medium">
                Existing session
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <StatBox label="New songs" value={check.new_songs} accent="text-emerald-400" />
            <StatBox label="Already archived" value={check.existing_songs} accent="text-gray-400" />
          </div>
          <div className="flex gap-2.5">
            <ModeButton
              label={check.new_songs > 0 ? `Sync ${check.new_songs} New Song${check.new_songs !== 1 ? "s" : ""}` : "Nothing new to sync"}
              sub="Download only tracks not yet archived"
              primary
              disabled={check.new_songs === 0}
              onClick={() => handleDownload("sync")}
            />
            <ModeButton
              label="Full Re-download"
              sub="Re-archive every track from scratch"
              onClick={() => handleDownload("full")}
            />
          </div>
          {check.new_songs === 0 && !check.is_new_session && (
            <p className="text-xs text-gray-500 text-center">
              Playlist is up to date. Use "Full Re-download" to refresh all files.
            </p>
          )}
        </div>
      )}

      {step === "starting" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-950/50 border border-indigo-800/50 rounded-xl">
          <Spinner />
          <span className="text-indigo-300 text-sm">Queuing downloads — redirecting…</span>
        </div>
      )}
    </div>
  );
}

// ── Single Track tab ──────────────────────────────────────────────────────────

function SingleTrackTab() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [check, setCheck] = useState<PlaylistCheckResponse | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const busy = step === "checking" || step === "starting";

  const handleAnalyze = async () => {
    if (!url.trim() || busy) return;
    setErrMsg("");
    setCheck(null);
    setStep("checking");
    try {
      const result = await checkUrl({ url, mode: "single" });
      setCheck(result);
      setStep("confirm");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Could not fetch video info. Check the URL and try again.";
      setErrMsg(msg);
      setStep("error");
    }
  };

  const handleDownload = async () => {
    setStep("starting");
    try {
      const result = await startDownload({ url, mode: "single" });
      navigate(`/session/${result.session_id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Failed to start download.";
      setErrMsg(msg);
      setStep("error");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Paste a YouTube video URL — even one copied from inside a playlist.
        Only that single track will be downloaded.
      </p>

      {/* URL row */}
      <div className="flex gap-2.5">
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setStep("idle"); setCheck(null); setErrMsg(""); }}
          onKeyDown={(e) => e.key === "Enter" && step === "idle" && handleAnalyze()}
          placeholder="https://youtube.com/watch?v=…"
          disabled={busy}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleAnalyze}
          disabled={!url.trim() || busy}
          className="flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {step === "checking" ? <><Spinner small /> Checking</> : "Analyze"}
        </button>
      </div>

      {/* Error */}
      {step === "error" && errMsg && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setStep("idle")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Confirm panel */}
      {step === "confirm" && check && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            {check.is_new_session || check.new_songs > 0 ? (
              <span className="px-2.5 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-full text-xs font-medium">
                New track
              </span>
            ) : (
              <span className="px-2.5 py-0.5 bg-yellow-950 border border-yellow-800 text-yellow-400 rounded-full text-xs font-medium">
                Already archived
              </span>
            )}
          </div>

          <div className="flex gap-3">
            <StatBox label="New" value={check.new_songs} accent="text-emerald-400" />
            <StatBox label="Already archived" value={check.existing_songs} accent="text-gray-400" />
          </div>

          <div className="flex gap-2.5">
            {check.new_songs > 0 && (
              <ModeButton
                label="Download Track"
                sub="Archive this single song"
                primary
                onClick={handleDownload}
              />
            )}
            <ModeButton
              label="Re-download"
              sub="Replace existing file"
              onClick={handleDownload}
            />
          </div>
        </div>
      )}

      {step === "starting" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-950/50 border border-indigo-800/50 rounded-xl">
          <Spinner />
          <span className="text-indigo-300 text-sm">Queuing download — redirecting…</span>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DownloadForm() {
  const [tab, setTab] = useState<Tab>("playlist");

  return (
    <div className="w-full max-w-xl">
      {/* Heading */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white tracking-tight mb-1">HarmonySync</h1>
        <p className="text-gray-500 text-sm">
          320 kbps · −14 LUFS · SponsorBlock · Spotify metadata
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl mb-6 border border-gray-700/50">
        {(["playlist", "single"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t
                ? "bg-indigo-600 text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "playlist" ? "Playlist / Channel" : "Single Track"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "playlist" ? <PlaylistTab /> : <SingleTrackTab />}
    </div>
  );
}
