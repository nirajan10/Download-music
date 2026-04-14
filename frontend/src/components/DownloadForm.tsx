import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkUrl, startDownload, uploadSongs } from "../api";
import type { CheckedTrack, PlaylistCheckResponse } from "../types";

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
    <div className="flex-1 bg-zinc-900/70 rounded-xl px-4 py-3 border border-zinc-700/50">
      <div className={`text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
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
          ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-900/40"
          : "bg-zinc-900/60 hover:bg-zinc-800 border-zinc-700 text-zinc-300"
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className={`text-xs ${primary ? "text-emerald-200" : "text-zinc-500"}`}>{sub}</span>
    </button>
  );
}

const QUALITY_OPTIONS = [128, 192, 256, 320] as const;
type Quality = typeof QUALITY_OPTIONS[number];

function QualityPicker({ value, onChange }: { value: Quality; onChange: (q: Quality) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 shrink-0">Quality</span>
      <div className="flex gap-1">
        {QUALITY_OPTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onChange(q)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              value === q
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700"
            }`}
          >
            {q}
          </button>
        ))}
      </div>
      <span className="text-xs text-zinc-600">kbps</span>
    </div>
  );
}

// ── Track list preview ────────────────────────────────────────────────────────

function TrackList({ tracks, mode }: { tracks: CheckedTrack[]; mode: "sync" | "full" }) {
  const [expanded, setExpanded] = useState(false);
  if (!tracks.length) return null;

  const visible = expanded ? tracks : tracks.slice(0, 8);
  const hiddenCount = tracks.length - visible.length;

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-zinc-700/60 bg-zinc-800/40">
        <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
          Tracks ({tracks.length})
        </span>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> New
          </span>
          <span className="flex items-center gap-1 text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" /> Archived
          </span>
        </div>
      </div>
      <ol className="max-h-64 overflow-y-auto divide-y divide-zinc-800/80">
        {visible.map((t, i) => {
          const dim = mode === "sync" && t.existing;
          return (
            <li
              key={t.youtube_id}
              className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors ${
                dim ? "text-zinc-600" : "text-zinc-200"
              } hover:bg-zinc-800/40`}
            >
              <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-zinc-600">
                {i + 1}
              </span>
              <span
                className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                  t.existing ? "bg-zinc-600" : "bg-emerald-500"
                }`}
              />
              <span className="flex-1 min-w-0 truncate">{t.title}</span>
              {t.existing && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                  {mode === "sync" ? "skip" : "replace"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {hiddenCount > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3.5 py-2 text-xs text-zinc-400 hover:text-white bg-zinc-800/30 hover:bg-zinc-800/60 border-t border-zinc-700/60 transition-colors"
        >
          Show {hiddenCount} more…
        </button>
      )}
      {expanded && tracks.length > 8 && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full px-3.5 py-2 text-xs text-zinc-400 hover:text-white bg-zinc-800/30 hover:bg-zinc-800/60 border-t border-zinc-700/60 transition-colors"
        >
          Collapse
        </button>
      )}
    </div>
  );
}

// ── SponsorBlock toggle ───────────────────────────────────────────────────────

function SponsorBlockToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
        <div
          onClick={() => onChange(!enabled)}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            enabled ? "bg-emerald-600" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </div>
        <span className="text-sm text-zinc-300">Remove non-music sections (SponsorBlock)</span>
      </label>
      {enabled && (
        <p className="text-xs text-amber-400/80 leading-relaxed ml-11">
          Community-sourced data — may cut songs in unexpected ways. Use with caution.
        </p>
      )}
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
  const [sponsorblock, setSponsorblock] = useState(false);

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
        folder_override: mode === "sync" && useExistingFolder && check?.existing_folder
          ? check.existing_folder
          : undefined,
        sponsorblock,
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
      <p className="text-zinc-400 text-sm leading-relaxed">
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
          className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
        />
        <button
          onClick={handleAnalyze}
          disabled={!url.trim() || busy}
          className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/30"
        >
          {step === "checking" ? <><Spinner small /> Checking</> : "Analyze"}
        </button>
      </div>

      {/* Error */}
      {step === "error" && errMsg && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setStep("idle")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Confirm panel */}
      {step === "confirm" && check && (
        <div className="bg-zinc-800/50 border border-zinc-700/60 rounded-2xl p-5 space-y-5 shadow-xl shadow-black/20">
          <div>
            {check.is_new_session ? (
              <span className="px-2.5 py-0.5 bg-emerald-950 border border-emerald-800/60 text-emerald-400 rounded-full text-xs font-medium">
                New playlist
              </span>
            ) : (
              <span className="px-2.5 py-0.5 bg-blue-950 border border-blue-800/60 text-blue-400 rounded-full text-xs font-medium">
                Existing session
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <StatBox label="New songs" value={check.new_songs} accent="text-emerald-400" />
            <StatBox label="Already archived" value={check.existing_songs} accent="text-zinc-400" />
          </div>
          {/* Session name */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Session name</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Chill Mix 2024"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all"
            />
          </div>

          {/* Folder option */}
          {check.existing_folder && (
            <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-lg border border-zinc-700/60">
              <button
                onClick={() => setUseExistingFolder(true)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  useExistingFolder
                    ? "bg-emerald-600 text-white shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Use existing folder
              </button>
              <button
                onClick={() => setUseExistingFolder(false)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  !useExistingFolder
                    ? "bg-emerald-600 text-white shadow"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Create new folder
              </button>
            </div>
          )}
          {check.existing_folder && (
            <p className="text-xs text-zinc-600 -mt-1 leading-relaxed">
              {useExistingFolder
                ? <>Files will be saved to <span className="text-zinc-400 font-mono">{check.existing_folder}/</span></>
                : "A new folder will be created for this download."}
            </p>
          )}

          <TrackList tracks={check.tracks} mode="sync" />

          <QualityPicker value={quality} onChange={setQuality} />
          <SponsorBlockToggle enabled={sponsorblock} onChange={setSponsorblock} />
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
            <p className="text-xs text-zinc-500 text-center">
              Playlist is up to date. Use "Full Re-download" to refresh all files.
            </p>
          )}
        </div>
      )}

      {step === "starting" && (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-950/40 border border-emerald-800/40 rounded-xl">
          <Spinner />
          <span className="text-emerald-300 text-sm">Queuing downloads — redirecting…</span>
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
  const [sponsorblock, setSponsorblock] = useState(false);

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
        sponsorblock,
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
      <p className="text-zinc-400 text-sm leading-relaxed">
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
          className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
        />
        <button
          onClick={handleAnalyze}
          disabled={!url.trim() || busy}
          className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/30"
        >
          {step === "checking" ? <><Spinner small /> Checking</> : "Analyze"}
        </button>
      </div>

      {/* Error */}
      {step === "error" && errMsg && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setStep("idle")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Confirm panel */}
      {step === "confirm" && check && (
        <div className="bg-zinc-800/50 border border-zinc-700/60 rounded-2xl p-5 space-y-4 shadow-xl shadow-black/20">
          <div className="flex items-center gap-2">
            {check.is_new_session || check.new_songs > 0 ? (
              <span className="px-2.5 py-0.5 bg-emerald-950 border border-emerald-800/60 text-emerald-400 rounded-full text-xs font-medium">
                New track
              </span>
            ) : (
              <span className="px-2.5 py-0.5 bg-yellow-950 border border-yellow-800/60 text-yellow-400 rounded-full text-xs font-medium">
                Already archived
              </span>
            )}
          </div>

          {check.playlist_title && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-zinc-900/60 rounded-xl border border-zinc-700/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0 mt-0.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              <span className="text-sm text-zinc-200 leading-snug break-words min-w-0">{check.playlist_title}</span>
            </div>
          )}

          <div className="flex gap-3">
            <StatBox label="New" value={check.new_songs} accent="text-emerald-400" />
            <StatBox label="Already archived" value={check.existing_songs} accent="text-zinc-400" />
          </div>

          {check.tracks.length > 0 && <TrackList tracks={check.tracks} mode="sync" />}

          <QualityPicker value={quality} onChange={setQuality} />
          <SponsorBlockToggle enabled={sponsorblock} onChange={setSponsorblock} />

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
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-950/40 border border-emerald-800/40 rounded-xl">
          <Spinner />
          <span className="text-emerald-300 text-sm">Queuing download — redirecting…</span>
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
      <p className="text-zinc-400 text-sm leading-relaxed">
        Add MP3 files from your drive. Existing ID3 tags are read automatically —
        then use the metadata editor to search iTunes or Spotify.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 px-6 py-10 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
          dragging
            ? "border-emerald-500 bg-emerald-950/20"
            : "border-zinc-700 hover:border-zinc-500 bg-zinc-800/30"
        }`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={dragging ? "text-emerald-400" : "text-zinc-500"}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-sm text-zinc-400">
          Drag &amp; drop MP3 files here, or <span className="text-emerald-400">browse</span>
        </p>
        <p className="text-xs text-zinc-600">MP3 only</p>
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
        <div className="flex items-start gap-3 px-4 py-3 bg-red-950/50 border border-red-800/60 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5 shrink-0 text-red-500">✕</span>
          <span className="flex-1">{errMsg}</span>
          <button onClick={() => setErrMsg("")} className="shrink-0 text-red-500 hover:text-red-400">✕</button>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-zinc-800 rounded-lg border border-zinc-700/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              <span className="flex-1 text-sm text-zinc-200 truncate">{f.name}</span>
              <span className="text-xs text-zinc-500 shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                onClick={() => removeFile(i)}
                className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors"
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
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-900/30"
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
      <div className="mb-7">
        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-1.5">HarmonySync</h1>
        <p className="text-zinc-500 text-sm">
          320 kbps · SponsorBlock · iTunes &amp; Spotify metadata
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-800/60 rounded-xl mb-6 border border-zinc-700/50">
        {(["playlist", "single", "upload"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t
                ? "bg-emerald-600 text-white shadow-md"
                : "text-zinc-400 hover:text-zinc-200"
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
