"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface HistoryEntry {
  id: string;
  name: string;
  crxUrl: string;
  timestamp: number;
}

const STORAGE_KEY = "crx-history";

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

function buildProxyUrl(extensionId: string): string {
  return `/api/crx/${extensionId}`;
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

function HomeInner() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ id: string; name: string; crxUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // ignore
    }
    setInitialized(true);
  }, []);

  const saveHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, []);

  const processExtension = useCallback(
    (id: string, name: string, currentHistory: HistoryEntry[]) => {
      const crxUrl = buildCrxUrl(id);
      setResult({ id, name, crxUrl });

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
      // Clean up URL without triggering navigation
      window.history.replaceState({}, "", "/");
    }
    // Only run when initialized and searchParams change
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

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemove = (id: string) => {
    saveHistory(history.filter((h) => h.id !== id));
    if (result?.id === id) setResult(null);
  };

  const handleClear = () => {
    saveHistory([]);
    setResult(null);
  };

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Decorative top bar */}
      <div className="h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent" />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-16 sm:py-24">
        {/* Header */}
        <header className="mb-14 animate-fade-up">
          <div className="flex items-center gap-3 mb-4">
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
            Download <span className="text-accent font-normal">Chrome extension</span> CRX files.
          </p>
          <p className="mt-3 text-muted text-sm font-mono">
            Paste a Chrome Web Store URL &rarr; get the direct .crx download link
          </p>
        </header>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://chromewebstore.google.com/detail/..."
                className="w-full bg-surface border border-border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent transition-colors"
                spellCheck={false}
              />
            </div>
            <button
              type="submit"
              className="bg-accent text-background px-6 py-3 font-mono text-sm font-medium uppercase tracking-wider hover:bg-accent-dim transition-colors cursor-pointer shrink-0"
            >
              Get CRX
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
              <span className="text-[10px] font-mono text-accent bg-accent/10 px-2 py-0.5 border border-accent/20 uppercase tracking-widest shrink-0">
                Ready
              </span>
            </div>

            <div className="bg-background border border-border p-3 mt-4">
              <p className="text-xs font-mono text-muted mb-2 uppercase tracking-wider">CRX Download URL</p>
              <p className="text-xs font-mono text-foreground/80 break-all leading-relaxed select-all">
                {result.crxUrl}
              </p>
            </div>

            <div className="flex gap-3 mt-4">
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
              <a
                href={buildProxyUrl(result.id)}
                download={`${result.id}.crx`}
                className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-dim transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download .crx
              </a>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="animate-fade-up" style={{ animationDelay: "0.2s" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted">
                History
                <span className="ml-2 text-accent/60">{history.length}</span>
              </h2>
              <button
                onClick={handleClear}
                className="text-[10px] font-mono uppercase tracking-wider text-muted hover:text-danger transition-colors cursor-pointer"
              >
                Clear all
              </button>
            </div>

            <div className="border-t border-border">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-4 py-3 border-b border-border group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm capitalize truncate">{entry.name}</p>
                    <p className="text-[10px] font-mono text-muted mt-0.5 truncate">
                      {entry.id}
                      <span className="mx-2 text-border">|</span>
                      {timeAgo(entry.timestamp)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={buildProxyUrl(entry.id)}
                      download={`${entry.id}.crx`}
                      className="text-[10px] font-mono uppercase tracking-wider text-accent hover:text-accent-dim transition-colors px-2 py-1 border border-accent/20 hover:border-accent/40"
                      title="Download CRX"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="inline -mt-px">
                        <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="ml-1.5 hidden sm:inline">.crx</span>
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
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-2xl mx-auto px-5 pb-8">
        <div className="border-t border-border pt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-[10px] font-mono text-muted uppercase tracking-wider">
            Free &amp; open source &mdash; no tracking, no accounts
          </p>
          <p className="text-[10px] font-mono text-muted/40">
            CRX Grabber
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
