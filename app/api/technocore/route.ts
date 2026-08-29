import { NextRequest, NextResponse } from "next/server";

const ORIGIN = "https://technocore.chat";
const ALLOWED_PREFIXES = ["/r/", "/kv/", "/rooms", "/healthz", "/.well-known/"];
const READ_TIMEOUT_MS = 15000;
const ROOM_POST_RE = /^\/r\/[a-z0-9][a-z0-9_-]{0,47}$/;

export const maxDuration = 60;

function timeoutResponse() {
  return new NextResponse(
    "Technocore read timed out after 15 seconds. No new read-back was confirmed.",
    { status: 504 },
  );
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  if (!requestedPath.startsWith("/") || !ALLOWED_PREFIXES.some((prefix) => requestedPath.startsWith(prefix))) {
    return new NextResponse("Unsupported Technocore path.", { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  try {
    const response = await fetch(`${ORIGIN}${requestedPath}`, {
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
    if (error instanceof Error && error.name === "AbortError") return timeoutResponse();
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

  // Technocore rate limits room creation per client IP. A server-side fetch here makes
  // every console user share the Vercel egress IP and therefore the same room budget.
  // 303 moves the signed GET write back to the browser. The browser may be unable to read
  // the cross-origin response because of CORS; that is fine. Client code treats that as an
  // unconfirmed write and verifies delivery through the read proxy immediately afterwards.
  return NextResponse.redirect(signedUrl, 303);
}
