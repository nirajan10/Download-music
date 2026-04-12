import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkUrl, startDownload, uploadSongs } from "../api";
import type { PlaylistCheckResponse } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "playlist" | "single" | "upload";
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


const QUALITY_OPTIONS = [128, 192, 256, 320] as const;
type Quality = typeof QUALITY_OPTIONS[number];

function QualityPicker({ value, onChange }: { value: Quality; onChange: (q: Quality) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 shrink-0">Quality</span>
      <div className="flex gap-1">
        {QUALITY_OPTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onChange(q)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              value === q
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
            }`}
          >
            {q}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-600">kbps</span>
    </div>
  );
}

// ── Playlist tab ──────────────────────────────────────────────────────────────

function PlaylistTab() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [check, setCheck] = useState<PlaylistCheckResponse | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [quality, setQuality] = useState<Quality>(320);
  const [sessionName, setSessionName] = useState("");
  const [useExistingFolder, setUseExistingFolder] = useState(false);

  const busy = step === "checking" || step === "starting";

  const handleAnalyze = async () => {
    if (!url.trim() || busy) return;
    setErrMsg("");
    setCheck(null);
    setStep("checking");
    try {
      const result = await checkUrl({ url, mode: "sync" });
      setCheck(result);
      setSessionName(result.playlist_title ?? "");
      setUseExistingFolder(!!result.existing_folder);
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
      const result = await startDownload({
        url,
        mode,
        quality,
        name: sessionName.trim() || undefined,
        // Full re-download always gets a new folder (handled by backend too);
        // only pass folder_override for sync so new songs land alongside existing ones.
        folder_override: mode === "sync" && useExistingFolder && check?.existing_folder
          ? check.existing_folder
          : undefined,
      });
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
          {/* Session name */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Session name</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Chill Mix 2024"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Folder option — only when a previous download exists for this playlist */}
          {check.existing_folder && (
            <div className="flex gap-1 p-1 bg-gray-900/60 rounded-lg border border-gray-700/60">
              <button
                onClick={() => setUseExistingFolder(true)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  useExistingFolder
                    ? "bg-indigo-600 text-white shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Use existing folder
              </button>
              <button
                onClick={() => setUseExistingFolder(false)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  !useExistingFolder
                    ? "bg-indigo-600 text-white shadow"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Create new folder
              </button>
            </div>
          )}
          {check.existing_folder && (
            <p className="text-xs text-gray-600 -mt-1 leading-relaxed">
              {useExistingFolder
                ? <>Files will be saved to <span className="text-gray-400 font-mono">{check.existing_folder}/</span></>
                : "A new folder will be created for this download."}
            </p>
          )}

          <QualityPicker value={quality} onChange={setQuality} />
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
  const [quality, setQuality] = useState<Quality>(320);

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
      const result = await startDownload({
        url,
        mode: "single",
        quality,
      });
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

          <QualityPicker value={quality} onChange={setQuality} />

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

// ── Upload tab ────────────────────────────────────────────────────────────────

function UploadTab() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const mp3s = Array.from(incoming).filter((f) =>
      f.name.toLowerCase().endsWith(".mp3")
    );
    if (mp3s.length === 0) {
      setErrMsg("Only MP3 files are supported.");
      return;
    }
    setErrMsg("");
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...mp3s.filter((f) => !existing.has(f.name + f.size))];
    });
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleUpload = async () => {
    if (!files.length || uploading) return;
    setUploading(true);
    setErrMsg("");
    try {
      const result = await uploadSongs(files);
      navigate(`/session/${result.session_id}`);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Upload failed.";
      setErrMsg(msg);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Add MP3 files from your drive. Existing ID3 tags are read automatically —
        then use the metadata editor to search iTunes or Spotify.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 px-6 py-10 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
          dragging
            ? "border-indigo-500 bg-indigo-950/30"
            : "border-gray-700 hover:border-gray-500 bg-gray-800/40"
        }`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-sm text-gray-400">
          Drag &amp; drop MP3 files here, or <span className="text-indigo-400">browse</span>
        </p>
        <p className="text-xs text-gray-600">MP3 only</p>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* Error */}
      {errMsg && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setErrMsg("")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400 shrink-0">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              <span className="flex-1 text-sm text-gray-200 truncate">{f.name}</span>
              <span className="text-xs text-gray-500 shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                onClick={() => removeFile(i)}
                className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {files.length > 0 && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {uploading ? (
            <><Spinner small /> Uploading…</>
          ) : (
            `Upload ${files.length} file${files.length !== 1 ? "s" : ""}`
          )}
        </button>
      )}
    </div>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

export function DownloadForm({ spotifyConfigured = false }: { spotifyConfigured?: boolean }) {
  const [tab, setTab] = useState<Tab>("playlist");

  return (
    <div className="w-full max-w-xl">
      {/* Heading */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white tracking-tight mb-1">HarmonySync</h1>
        <p className="text-gray-500 text-sm">
          320 kbps · SponsorBlock · iTunes &amp; Spotify metadata
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl mb-6 border border-gray-700/50">
        {(["playlist", "single", "upload"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t
                ? "bg-indigo-600 text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "playlist" ? "Playlist" : t === "single" ? "Single" : "Upload"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "playlist" ? <PlaylistTab />
        : tab === "single" ? <SingleTrackTab />
        : <UploadTab />
      }
    </div>
  );
}
