import { NextRequest, NextResponse } from "next/server";

const CRX_URL_TEMPLATE =
  "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D{ID}%26uc";

// 20MB max — covers virtually all extensions, keeps bandwidth in check
const MAX_CRX_SIZE = 20 * 1024 * 1024;

// Simple in-memory rate limiter (per-instance, resets on cold start)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT = 5; // requests per window per IP — personal use

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Periodic cleanup to prevent memory leak from stale entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(ip);
  }
}, RATE_WINDOW_MS);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validate extension ID: must be exactly 32 lowercase letters
  if (!/^[a-z]{32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid extension ID" }, { status: 400 });
  }

  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const url = CRX_URL_TEMPLATE.replace("{ID}", id);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(9_000), // 9s — stay under Vercel hobby 10s limit
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch CRX file" },
        { status: response.status }
      );
    }

    // Check Content-Length before streaming
    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_CRX_SIZE) {
      return NextResponse.json(
        { error: "Extension file too large" },
        { status: 413 }
      );
    }

    // Stream the response instead of buffering the entire blob in memory
    const upstream = response.body;
    if (!upstream) {
      return NextResponse.json(
        { error: "No response body from upstream" },
        { status: 502 }
      );
    }

    // Pipe through a TransformStream that enforces the size limit
    let bytesRead = 0;
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_CRX_SIZE) {
          controller.error(new Error("Response exceeded maximum size"));
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-chrome-extension",
      "Content-Disposition": `attachment; filename="${id}.crx"`,
      "Cache-Control": "private, no-store",
    };
    if (contentLength > 0) {
      headers["Content-Length"] = contentLength.toString();
    }

    return new Response(upstream.pipeThrough(limiter), { headers });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "Upstream request timed out"
        : "Failed to download CRX file";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
