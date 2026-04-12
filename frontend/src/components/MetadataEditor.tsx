import { useEffect, useRef, useState } from "react";
import {
  fetchSongMetadata,
  updateSongMetadata,
  searchMetadata,
  applySpotifyMatch,
  applyItunesMatch,
  uploadCoverArt,
  getCoverArtUrl,
  fetchSpotifySettings,
} from "../api";
import type { SongMetadata, MetadataCandidate } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  songId: number;
  songTitle: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

interface FormFields {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function Spin() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function MetadataEditor({ songId, songTitle, onClose, onSaved }: Props) {
  const [meta, setMeta] = useState<SongMetadata | null>(null);
  const [form, setForm] = useState<FormFields>({ title: "", artist: "", album: "", year: "", genre: "" });
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState(0);

  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [activeSource, setActiveSource] = useState<"itunes" | "spotify">("itunes");
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load metadata on mount ──────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSpotifySettings().then((s) => setSpotifyConfigured(s.configured));
    fetchSongMetadata(songId)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        setForm({
          title: m.title ?? "",
          artist: m.artist ?? "",
          album: m.album ?? "",
          year: m.year ?? "",
          genre: m.genre ?? "",
        });
        if (m.cover_url) setCoverUrl(m.cover_url);
      })
      .catch(() => setMsg({ type: "err", text: "Failed to load metadata" }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [songId]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const set = (key: keyof FormFields, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const updated = await updateSongMetadata(songId, form);
      setMeta(updated);
      setMsg({ type: "ok", text: "Saved" });
      onSaved?.();
    } catch {
      setMsg({ type: "err", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setMsg(null);
    setCandidates([]);
    setSelectedId(null);
    try {
      const raw = await searchMetadata(
        songId,
        { title: form.title || undefined, artist: form.artist || undefined },
        activeSource,
      );
      // Tag each candidate with its source for the discriminated union
      const tagged = (raw as object[]).map((c) =>
        ({ ...c, source: activeSource } as MetadataCandidate)
      );
      setCandidates(tagged);
      if (tagged.length === 0)
        setMsg({ type: "err", text: `No ${activeSource === "itunes" ? "iTunes" : "Spotify"} results` });
    } catch {
      setMsg({ type: "err", text: "Search failed" });
    } finally {
      setSearching(false);
    }
  };

  const candidateKey = (c: MetadataCandidate): string =>
    c.source === "spotify" ? c.spotify_id : String(c.itunes_id);

  const handleSelectCandidate = (c: MetadataCandidate) => {
    setSelectedId(candidateKey(c));
    setSelectedCoverUrl(c.cover_url);
    setForm({
      title: c.title,
      artist: c.artist,
      album: c.album ?? "",
      year: c.year ?? "",
      genre: c.genre ?? "",
    });
  };

  const handleApply = async () => {
    if (!selectedId) return;
    setApplying(true);
    setMsg(null);
    try {
      const selected = candidates.find((c) => candidateKey(c) === selectedId);
      if (!selected) return;

      let updated: SongMetadata;
      if (selected.source === "spotify") {
        updated = await applySpotifyMatch(songId, {
          spotify_id: selected.spotify_id,
          cover_url: selectedCoverUrl ?? undefined,
          title: form.title || undefined,
          artist: form.artist || undefined,
          album: form.album || undefined,
          year: form.year || undefined,
          genre: form.genre || undefined,
        });
      } else {
        updated = await applyItunesMatch(songId, {
          itunes_id: selected.itunes_id,
          cover_url: selectedCoverUrl ?? undefined,
          title: form.title || undefined,
          artist: form.artist || undefined,
          album: form.album || undefined,
          year: form.year || undefined,
          genre: form.genre || undefined,
        });
      }

      setMeta(updated);
      if (updated.cover_url) setCoverUrl(updated.cover_url);
      setCoverKey((k) => k + 1);
      setCandidates([]);
      setSelectedId(null);
      setMsg({ type: "ok", text: `Applied from ${selected.source === "spotify" ? "Spotify" : "iTunes"}` });
      onSaved?.();
    } catch {
      setMsg({ type: "err", text: "Apply failed" });
    } finally {
      setApplying(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    try {
      const result = await uploadCoverArt(songId, file);
      setCoverUrl(result.cover_url);
      setCoverKey((k) => k + 1);
      setMsg({ type: "ok", text: "Cover updated" });
      onSaved?.();
    } catch {
      setMsg({ type: "err", text: "Cover upload failed" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const busy = saving || searching || applying;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-gray-900 border-l border-gray-700 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-sm truncate">Edit Metadata</h2>
            <p className="text-gray-500 text-xs truncate">{songTitle ?? `Song #${songId}`}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg px-1">✕</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spin />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            {/* Cover art */}
            <div className="flex items-start gap-4">
              <div
                className="w-24 h-24 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer"
                onClick={() => fileRef.current?.click()}
                title="Click to change cover"
              >
                {coverUrl ? (
                  <img
                    key={coverKey}
                    src={getCoverArtUrl(songId) + `?t=${coverKey}`}
                    alt="Cover"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-600 text-xs text-center px-2">No cover<br />Click to add</span>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              <div className="flex-1 space-y-1.5 pt-1">
                <p className="text-xs text-gray-500">
                  Source: <span className="text-gray-400">{meta?.metadata_source ?? "youtube"}</span>
                </p>
                {meta?.spotify_id && (
                  <p className="text-xs text-gray-500">
                    Spotify ID: <span className="text-gray-400 font-mono text-[10px]">{meta.spotify_id}</span>
                  </p>
                )}
                {meta?.itunes_id && (
                  <p className="text-xs text-gray-500">
                    iTunes ID: <span className="text-gray-400 font-mono text-[10px]">{meta.itunes_id}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              {([
                ["title", "Title"],
                ["artist", "Artist"],
                ["album", "Album"],
                ["year", "Year"],
                ["genre", "Genre"],
              ] as [keyof FormFields, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder={label}
                  />
                </div>
              ))}
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={busy}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <><Spin /> Saving...</> : "Save Metadata"}
            </button>

            {/* Divider + Lookup section */}
            <div className="border-t border-gray-800 pt-4">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Metadata Lookup</h3>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                Searches using the <span className="text-gray-500">Title</span> field above as the query — edit it to
                something like <span className="text-gray-500 italic">Artist – Song name</span> if the result isn't found.
                Not all songs will have a match; use the form above to tag them manually.
              </p>

              {/* Source selector — only when Spotify is also configured */}
              {spotifyConfigured && (
                <div className="flex gap-1 p-1 bg-gray-800/60 rounded-lg border border-gray-700/50 mb-3">
                  {(["itunes", "spotify"] as const).map((src) => (
                    <button
                      key={src}
                      onClick={() => { setActiveSource(src); setCandidates([]); setSelectedId(null); }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                        activeSource === src
                          ? "bg-indigo-600 text-white shadow"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {src === "itunes" ? "iTunes" : "Spotify"}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={handleSearch}
                disabled={busy}
                className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 border border-gray-700 text-gray-300 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {searching
                  ? <><Spin /> Searching...</>
                  : `Fetch from ${activeSource === "itunes" ? "iTunes" : "Spotify"}`}
              </button>
            </div>

            {/* Candidates */}
            {candidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  {candidates.length} result{candidates.length !== 1 ? "s" : ""} — click to select, then Apply
                </p>
                {candidates.map((c) => {
                  const key = candidateKey(c);
                  return (
                    <div
                      key={key}
                      onClick={() => handleSelectCandidate(c)}
                      className={`px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        selectedId === key
                          ? "border-indigo-500 bg-indigo-950/40"
                          : "border-gray-700 bg-gray-800/60 hover:bg-gray-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {c.cover_url && (
                            <img src={c.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                          )}
                          <span className="text-sm text-white font-medium truncate">{c.title}</span>
                        </div>
                        <span className="text-xs text-gray-500 shrink-0 ml-2">{c.score}</span>
                      </div>
                      <div className="text-xs text-gray-400 truncate mt-0.5">{c.artist}</div>
                      {c.album && (
                        <div className="text-xs text-gray-500 truncate">
                          {c.album}{c.year ? ` (${c.year})` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}

                {selectedId && (
                  <button
                    onClick={handleApply}
                    disabled={applying}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {applying ? <><Spin /> Applying...</> : "Apply Selected Match"}
                  </button>
                )}
              </div>
            )}

            {/* Status message */}
            {msg && (
              <div className={`text-xs text-center py-2 rounded-lg ${
                msg.type === "ok" ? "text-emerald-400 bg-emerald-950/30" : "text-red-400 bg-red-950/30"
              }`}>
                {msg.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
