import { NextRequest, NextResponse } from "next/server";

const ORIGIN = "https://technocore.chat";
const ALLOWED_PREFIXES = ["/r/", "/kv/", "/rooms", "/healthz", "/.well-known/"];
const READ_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 55000;
const ROOM_POST_RE = /^\/r\/[a-z0-9][a-z0-9_-]{0,47}$/;

export const maxDuration = 60;

function profileProofCompatibility(path: string): { upstreamPath: string; syntheticWrite: boolean } | null {
  const match = path.match(/^\/kv\/did-([0-9a-f]{2})\/([0-9a-f]{14})(?:\/set\/.*)?$/i);
  if (!match) return null;

  const fingerprint = `${match[1]}${match[2]}`.toLowerCase();
  return {
    upstreamPath: `/r/proof-${fingerprint}?format=json&limit=200&n=${Date.now()}`,
    syntheticWrite: path.includes("/set/"),
  };
}

function timeoutResponse(kind: "read" | "write") {
  return new NextResponse(
    kind === "write"
      ? "Technocore write did not finish within 55 seconds. Delivery remains unconfirmed; do not resend until read-back is checked."
      : "Technocore read timed out after 15 seconds. No new read-back was confirmed.",
    { status: 504 },
  );
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  if (!requestedPath.startsWith("/") || !ALLOWED_PREFIXES.some((prefix) => requestedPath.startsWith(prefix))) {
    return new NextResponse("Unsupported Technocore path.", { status: 400 });
  }

  const compatibility = profileProofCompatibility(requestedPath);
  if (compatibility?.syntheticWrite) {
    return new NextResponse(
      "Profile index compatibility accepted. Signed DID proof is the canonical profile record.",
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  const path = compatibility?.upstreamPath || requestedPath;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      method: "GET",
      headers: { Accept: "text/plain, application/json;q=0.9" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return timeoutResponse("read");
    return new NextResponse("Technocore is currently unreachable.", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new NextResponse("Invalid JSON body.", { status: 400 });
  }

  const value = input as {
    path?: unknown;
    dispatch?: unknown;
    payload?: { did?: unknown; sig?: unknown; nonce?: unknown; text?: unknown };
  };
  const path = typeof value.path === "string" ? value.path : "";
  const payload = value.payload;

  if (!ROOM_POST_RE.test(path)) {
    return new NextResponse("Unsupported Technocore POST path.", { status: 400 });
  }
  if (
    !payload ||
    typeof payload.did !== "string" ||
    typeof payload.sig !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.text !== "string"
  ) {
    return new NextResponse("Invalid signed message payload.", { status: 400 });
  }

  if (value.dispatch === "browser") {
    if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(payload.did)) {
      return new NextResponse("Invalid did:key value.", { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(payload.sig)) {
      return new NextResponse("Invalid signature value.", { status: 400 });
    }
    if (!/^\d{1,19}$/.test(payload.nonce)) {
      return new NextResponse("Invalid nonce value.", { status: 400 });
    }
    if (!payload.text.trim() || payload.text.length > 4096) {
      return new NextResponse("Invalid message text.", { status: 400 });
    }

    const room = path.slice(3);
    const signedUrl = new URL(
      `/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(payload.did)}/${encodeURIComponent(payload.sig)}/${encodeURIComponent(payload.nonce)}/${encodeURIComponent(payload.text)}`,
      ORIGIN,
    );
    return NextResponse.redirect(signedUrl, 303);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);

  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Accept: "text/plain, application/json;q=0.9",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        did: payload.did,
        sig: payload.sig,
        nonce: payload.nonce,
        text: payload.text,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return timeoutResponse("write");
    return new NextResponse("Technocore is currently unreachable.", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
