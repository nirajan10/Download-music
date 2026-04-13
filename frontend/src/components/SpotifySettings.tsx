import { useEffect, useState } from "react";
import { fetchSpotifySettings, saveSpotifySettings, clearSpotifySettings } from "../api";

function Spin() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

interface Props {
  onConfigured?: (configured: boolean) => void;
}

export function SpotifySettings({ onConfigured }: Props) {
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [existingClientId, setExistingClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetchSpotifySettings().then((s) => {
      setConfigured(s.configured);
      setExistingClientId(s.client_id);
      onConfigured?.(s.configured);
    });
  }, []);

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveSpotifySettings(clientId.trim(), clientSecret.trim());
      setConfigured(res.configured);
      setExistingClientId(clientId.trim());
      setClientId("");
      setClientSecret("");
      setShowForm(false);
      setMsg({ type: "ok", text: "Spotify credentials saved" });
      onConfigured?.(res.configured);
    } catch {
      setMsg({ type: "err", text: "Failed to save credentials" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setMsg(null);
    try {
      await clearSpotifySettings();
      setConfigured(false);
      setExistingClientId("");
      setShowForm(false);
      setMsg({ type: "ok", text: "Spotify credentials removed" });
      onConfigured?.(false);
    } catch {
      setMsg({ type: "err", text: "Failed to clear credentials" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${configured ? "bg-emerald-400" : "bg-gray-600"}`} />
          <span className="text-sm font-medium text-gray-300">Spotify Integration</span>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-700 text-gray-400">
            optional
          </span>
        </div>
        <div className="flex items-center gap-2">
          {configured && !showForm && (
            <button
              onClick={handleClear}
              disabled={clearing}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {clearing ? <Spin /> : "Remove"}
            </button>
          )}
          <button
            onClick={() => { setShowForm((v) => !v); setMsg(null); }}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {showForm ? "Cancel" : configured ? "Update" : "Set up"}
          </button>
        </div>
      </div>

      {/* Status */}
      {!showForm && (
        <p className="text-xs text-gray-500">
          {configured
            ? <>Credentials configured — ID: <span className="font-mono text-gray-400">{existingClientId.slice(0, 8)}…</span></>
            : "iTunes metadata is always available without any setup. Add Spotify credentials (requires a Premium account) to also search Spotify when editing metadata."}
        </p>
      )}

      {/* Form */}
      {showForm && (
        <div className="space-y-2.5 pt-1">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={configured ? "Enter new client ID" : "Spotify client ID"}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Client Secret</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Spotify client secret"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <p className="text-xs text-gray-600">
            Get credentials at{" "}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              developer.spotify.com/dashboard
            </a>
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <><Spin /> Saving…</> : "Save Credentials"}
          </button>
        </div>
      )}

      {/* Feedback */}
      {msg && (
        <p className={`text-xs ${msg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
