"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type DownloadFormat = "zip" | "crx";

interface HistoryEntry {
  id: string;
  name: string;
  crxUrl: string;
  timestamp: number;
}

const STORAGE_KEY = "crx-history";
const FORMAT_KEY = "crx-format";

function extractExtensionInfo(url: string): { id: string; name: string } | null {
  // Match both old and new Chrome Web Store URL formats
  const patterns = [
    /chromewebstore\.google\.com\/detail\/([^/]+)\/([a-z]{32})/i,
    /chrome\.google\.com\/webstore\/detail\/([^/]+)\/([a-z]{32})/i,
    /chromewebstore\.google\.com\/detail\/([a-z]{32})/i,
    /chrome\.google\.com\/webstore\/detail\/[^/]+\/([a-z]{32})/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      if (match.length === 3) {
        return {
          name: match[1].replace(/-/g, " "),
          id: match[2],
        };
      }
      return {
        name: match[1],
        id: match[1],
      };
    }
  }

  // Try bare extension ID (32 lowercase chars)
  const bareId = url.trim().match(/^([a-z]{32})$/);
  if (bareId) {
    return { id: bareId[1], name: bareId[1] };
  }

  return null;
}

function buildCrxUrl(extensionId: string): string {
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc`;
}

function buildProxyUrl(extensionId: string, name?: string): string {
  const base = `/api/crx/${extensionId}`;
  if (name) return `${base}?name=${encodeURIComponent(name)}`;
  return base;
}

function buildStoreUrl(extensionId: string): string {
  return `https://chromewebstore.google.com/detail/${extensionId}`;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ─── Chrome logo (simplified 4-color mark) ─── */
function ChromeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth="1" />
      <path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335" opacity="0.8" />
      <path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05" opacity="0.8" />
      <path d="M24 40A16 16 0 0 1 10.14 16L24 16z" fill="#34A853" opacity="0.8" />
      <circle cx="24" cy="24" r="7" fill="#4285F4" opacity="0.9" />
      <circle cx="24" cy="24" r="4" fill="#1e1e1e" />
    </svg>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ id: string; name: string; crxUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [format, setFormat] = useState<DownloadFormat>("zip");

  // Load history + format preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored));
      const savedFormat = localStorage.getItem(FORMAT_KEY);
      if (savedFormat === "crx" || savedFormat === "zip") setFormat(savedFormat);
    } catch {
      // ignore
    }
    setInitialized(true);
  }, []);

  const handleFormatChange = (f: DownloadFormat) => {
    setFormat(f);
    localStorage.setItem(FORMAT_KEY, f);
  };

  const saveHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, []);

  const processExtension = useCallback(
    (id: string, name: string, currentHistory: HistoryEntry[]) => {
      const crxUrl = buildCrxUrl(id);
      setResult({ id, name, crxUrl });
      setError("");

      const entry: HistoryEntry = { id, name, crxUrl, timestamp: Date.now() };
      const updated = [entry, ...currentHistory.filter((h) => h.id !== id)];
      saveHistory(updated);
    },
    [saveHistory]
  );

  // Handle URL params (from /detail/... redirect)
  useEffect(() => {
    if (!initialized) return;

    const id = searchParams.get("id");
    const name = searchParams.get("name");
    if (id && /^[a-z]{32}$/i.test(id)) {
      processExtension(id.toLowerCase(), name || id, history);
      window.history.replaceState({}, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setCopied(false);

    const info = extractExtensionInfo(input.trim());
    if (!info) {
      setError("Could not extract extension ID. Paste a Chrome Web Store URL or a 32-char extension ID.");
      return;
    }

    processExtension(info.id, info.name, history);
  };

  const handleHistoryClick = (entry: HistoryEntry) => {
    setInput(buildStoreUrl(entry.id));
    setResult({ id: entry.id, name: entry.name, crxUrl: entry.crxUrl });
    setError("");
    setCopied(false);
    // Scroll to top smoothly so user sees the result
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setInput("");
    setError("");
    setResult(null);
    setCopied(false);
    inputRef.current?.focus();
  };

  const handleRemove = (id: string) => {
    saveHistory(history.filter((h) => h.id !== id));
    if (result?.id === id) {
      setResult(null);
      setInput("");
    }
  };

  const handleClearHistory = () => {
    saveHistory([]);
    setResult(null);
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Decorative top bar */}
      <div className="h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent" />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-16 sm:py-24">
        {/* Header */}
        <header className="mb-12 animate-fade-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 bg-accent/10 border border-accent/30 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-accent">
                <path d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M6 8l1.5 1.5L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="font-mono text-sm tracking-widest uppercase text-muted">
              CRX Grabber
            </h1>
          </div>
          <p className="text-3xl sm:text-4xl font-light tracking-tight leading-tight">
            Download <span className="text-accent font-normal">Chrome extensions</span> to sideload.
          </p>
          <p className="mt-3 text-muted text-sm font-mono">
            Paste a Chrome Web Store URL &rarr; grab as .zip or .crx
          </p>
        </header>

        {/* How it works — compact steps */}
        <div className="mb-10 animate-fade-up" style={{ animationDelay: "0.04s" }}>
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: "01", label: "Paste URL", desc: "Chrome Web Store link or extension ID" },
              { step: "02", label: "Choose format", desc: ".zip to sideload, .crx for raw file" },
              { step: "03", label: "Download", desc: "Unzip & load unpacked in Developer Mode" },
            ].map((s) => (
              <div key={s.step} className="border border-border bg-surface/50 p-3">
                <p className="text-accent font-mono text-[10px] tracking-widest mb-1.5">{s.step}</p>
                <p className="text-xs font-medium mb-0.5">{s.label}</p>
                <p className="text-[10px] font-mono text-muted/70 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Format toggle */}
        <div className="mb-6 animate-fade-up" style={{ animationDelay: "0.06s" }}>
          <div className="flex items-center gap-4">
            <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Format</p>
            <div className="flex border border-border">
              <button
                type="button"
                onClick={() => handleFormatChange("zip")}
                className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                  format === "zip"
                    ? "bg-accent text-background"
                    : "text-muted hover:text-foreground"
                }`}
              >
                .zip
              </button>
              <button
                type="button"
                onClick={() => handleFormatChange("crx")}
                className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider border-l border-border transition-colors cursor-pointer ${
                  format === "crx"
                    ? "bg-accent text-background"
                    : "text-muted hover:text-foreground"
                }`}
              >
                .crx
              </button>
            </div>
          </div>
          {format === "zip" ? (
            <p className="mt-2 text-[10px] font-mono text-muted/70 leading-relaxed">
              CRX header stripped server-side &rarr; valid .zip you can unzip &amp; load unpacked. 20 MB limit.
            </p>
          ) : (
            <p className="mt-2 text-[10px] font-mono text-muted/70 leading-relaxed">
              Raw .crx direct from Google &mdash; no size limit, no proxy. Cannot be unzipped directly.
            </p>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://chromewebstore.google.com/detail/..."
                className="w-full bg-surface border border-border pl-4 pr-9 py-3 font-mono text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent transition-colors"
                spellCheck={false}
              />
              {input && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors cursor-pointer"
                  title="Clear input"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="submit"
              className="bg-accent text-background px-6 py-3 font-mono text-sm font-medium uppercase tracking-wider hover:bg-accent-dim transition-colors cursor-pointer shrink-0"
            >
              Grab {format === "zip" ? ".zip" : ".crx"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-danger text-xs font-mono">{error}</p>
          )}
        </form>

        {/* Result */}
        {result && (
          <div className="mb-12 border border-accent/40 bg-surface p-5 animate-fade-up">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1">Extension</p>
                <p className="text-sm capitalize">{result.name}</p>
                <p className="text-xs font-mono text-muted mt-0.5">{result.id}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={buildStoreUrl(result.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-muted hover:text-foreground transition-colors uppercase tracking-widest px-2 py-0.5 border border-border hover:border-muted"
                  title="View on Chrome Web Store"
                >
                  Store &nearr;
                </a>
                <span className="text-[10px] font-mono text-accent bg-accent/10 px-2 py-0.5 border border-accent/20 uppercase tracking-widest">
                  Ready
                </span>
              </div>
            </div>

            {format === "crx" && (
              <div className="bg-background border border-border p-3 mt-4">
                <p className="text-xs font-mono text-muted mb-2 uppercase tracking-wider">Direct CRX URL</p>
                <p className="text-xs font-mono text-foreground/80 break-all leading-relaxed select-all">
                  {result.crxUrl}
                </p>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              {format === "crx" && (
                <button
                  onClick={() => handleCopy(result.crxUrl)}
                  className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="5" y="5" width="9" height="9" rx="1" />
                    <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
                  </svg>
                  {copied ? "Copied!" : "Copy URL"}
                </button>
              )}
              <a
                href={format === "zip" ? buildProxyUrl(result.id, result.name) : result.crxUrl}
                download={format === "crx" ? `${result.id}.crx` : undefined}
                className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-dim transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download {format === "zip" ? ".zip" : ".crx"}
              </a>
            </div>
          </div>
        )}

        {/* History */}
        {initialized && (
          <section className="animate-fade-up" style={{ animationDelay: "0.2s" }}>
            {history.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-mono uppercase tracking-widest text-muted">
                    History
                    <span className="ml-2 text-accent/60">{history.length}</span>
                  </h2>
                  <button
                    onClick={handleClearHistory}
                    className="text-[10px] font-mono uppercase tracking-wider text-muted hover:text-danger transition-colors cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>

                <div className="border-t border-border">
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-4 py-3 border-b border-border group cursor-pointer transition-colors hover:bg-surface/80 ${
                        result?.id === entry.id ? "bg-surface" : ""
                      }`}
                      onClick={() => handleHistoryClick(entry)}
                      title="Click to select this extension"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm capitalize truncate transition-colors ${
                          result?.id === entry.id ? "text-accent" : "group-hover:text-accent"
                        }`}>
                          {entry.name}
                        </p>
                        <p className="text-[10px] font-mono text-muted mt-0.5 truncate">
                          {entry.id}
                          <span className="mx-2 text-border">|</span>
                          {timeAgo(entry.timestamp)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={format === "zip" ? buildProxyUrl(entry.id, entry.name) : buildCrxUrl(entry.id)}
                          download={format === "crx" ? `${entry.id}.crx` : undefined}
                          className="text-[10px] font-mono uppercase tracking-wider text-accent hover:text-accent-dim transition-colors px-2 py-1 border border-accent/20 hover:border-accent/40"
                          title={format === "zip" ? "Download as ZIP" : "Download as CRX"}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="inline -mt-px">
                            <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="ml-1.5 hidden sm:inline">{format === "zip" ? ".zip" : ".crx"}</span>
                        </a>
                        <button
                          onClick={() => handleRemove(entry.id)}
                          className="text-[10px] font-mono text-muted hover:text-danger transition-colors px-2 py-1 border border-border hover:border-danger/40 cursor-pointer"
                          title="Remove from history"
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="inline -mt-px">
                            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : !result && (
              /* Empty state for first-time users */
              <div className="border border-dashed border-border py-10 px-6 text-center">
                <div className="flex justify-center mb-4 opacity-40">
                  <ChromeIcon size={32} />
                </div>
                <p className="text-sm text-muted mb-1">No extensions grabbed yet</p>
                <p className="text-[10px] font-mono text-muted/50 leading-relaxed max-w-sm mx-auto">
                  Paste a Chrome Web Store URL above to get started. Downloaded extensions will appear here for quick re-download.
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-2xl mx-auto px-5 pb-8">
        <div className="border-t border-border pt-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ChromeIcon size={14} />
              <p className="text-[10px] font-mono text-muted uppercase tracking-wider">
                For Chrome Web Store extensions
              </p>
            </div>
            <p className="text-[10px] font-mono text-muted/40">
              Free &amp; open source &mdash; no tracking
            </p>
          </div>
          <p className="mt-3 text-[9px] font-mono text-muted/30 leading-relaxed">
            Not affiliated with Google, Chrome, or the Chrome Web Store. All trademarks belong to their respective owners.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
