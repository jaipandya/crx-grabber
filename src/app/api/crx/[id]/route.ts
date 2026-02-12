import { NextRequest, NextResponse } from "next/server";

const CRX_URL_TEMPLATE =
  "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3D{ID}%26uc";

// 20MB max — covers virtually all extensions, keeps bandwidth in check
const MAX_CRX_SIZE = 20 * 1024 * 1024;

/**
 * Strip the CRX2/CRX3 header and return the embedded ZIP.
 *
 * CRX3 layout: "Cr24" (4 B) | version=3 (uint32 LE) | header_size (uint32 LE) | header | ZIP
 * CRX2 layout: "Cr24" (4 B) | version=2 (uint32 LE) | pk_len (uint32 LE) | sig_len (uint32 LE) | pk | sig | ZIP
 *
 * Falls back to scanning for the ZIP local-file-header magic (PK\x03\x04).
 */
function stripCrxHeader(buf: Uint8Array): Uint8Array | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Check for CRX magic "Cr24"
  if (buf[0] === 0x43 && buf[1] === 0x72 && buf[2] === 0x32 && buf[3] === 0x34) {
    const version = view.getUint32(4, true);
    let zipOffset: number;

    if (version === 3) {
      const headerSize = view.getUint32(8, true);
      zipOffset = 12 + headerSize;
    } else if (version === 2) {
      const pkLen = view.getUint32(8, true);
      const sigLen = view.getUint32(12, true);
      zipOffset = 16 + pkLen + sigLen;
    } else {
      return null;
    }

    if (zipOffset < buf.byteLength) {
      return buf.subarray(zipOffset);
    }
    return null;
  }

  // Fallback: scan for ZIP magic (PK\x03\x04)
  for (let i = 0; i < Math.min(buf.byteLength, 1024); i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      return buf.subarray(i);
    }
  }

  return null;
}

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

    // Buffer the full CRX so we can strip the header and serve pure ZIP
    const crxBuf = new Uint8Array(await response.arrayBuffer());

    if (crxBuf.byteLength > MAX_CRX_SIZE) {
      return NextResponse.json(
        { error: "Extension file too large" },
        { status: 413 }
      );
    }

    // Strip the CRX header to get a valid ZIP
    const zipData = stripCrxHeader(crxBuf);
    if (!zipData) {
      return NextResponse.json(
        { error: "Could not parse CRX file — invalid format" },
        { status: 502 }
      );
    }

    // Build a human-friendly filename: [name]-[id].zip
    const rawName = request.nextUrl.searchParams.get("name") || "";
    const safeName = rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = safeName ? `${safeName}-${id}.zip` : `${id}.zip`;

    return new Response(zipData, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": zipData.byteLength.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "Upstream request timed out"
        : "Failed to download CRX file";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
