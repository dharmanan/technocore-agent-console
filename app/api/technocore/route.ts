import { NextRequest, NextResponse } from "next/server";

const ORIGIN = "https://technocore.chat";
const ALLOWED_PREFIXES = ["/r/", "/kv/", "/rooms", "/healthz", "/.well-known/"];
const READ_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 22000;
const VERIFY_READ_TIMEOUT_MS = 5000;
const ROOM_POST_RE = /^\/r\/[a-z0-9][a-z0-9_-]{0,47}$/;

export const maxDuration = 60;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutResponse(kind: "read" | "write") {
  return new NextResponse(
    kind === "write"
      ? "Technocore write did not finish in time and could not yet be read back. Delivery remains unconfirmed."
      : "Technocore read timed out after 15 seconds. No new read-back was confirmed.",
    { status: 504 },
  );
}

async function roomContains(roomPath: string, did: string, textValue: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_READ_TIMEOUT_MS);
  try {
    const response = await fetch(`${ORIGIN}${roomPath}?format=json&limit=200&n=${Date.now()}`, {
      method: "GET",
      headers: { Accept: "application/json, text/plain;q=0.9" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { messages?: Array<{ from?: string; text?: string }> } | Array<{ from?: string; text?: string }>;
      const messages = Array.isArray(parsed) ? parsed : Array.isArray(parsed.messages) ? parsed.messages : [];
      return messages.some((message) => message.from === did && message.text === textValue);
    } catch {
      return raw.includes(did) && raw.includes(textValue);
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForRoomReadback(roomPath: string, did: string, textValue: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await roomContains(roomPath, did, textValue)) return true;
    if (attempt < 4) await wait(2500);
  }
  return false;
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
    payload?: { did?: unknown; sig?: unknown; nonce?: unknown; text?: unknown };
  };
  const path = typeof value.path === "string" ? value.path : "";
  const payload = value.payload;

  if (!ROOM_POST_RE.test(path)) {
    return new NextResponse("Unsupported Technocore write path.", { status: 400 });
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  let upstreamStatus = 504;
  let upstreamText = "Technocore signed write did not finish in time.";
  let upstreamCompleted = false;

  try {
    const response = await fetch(signedUrl, {
      method: "GET",
      headers: { Accept: "text/plain, application/json;q=0.9" },
      cache: "no-store",
      signal: controller.signal,
    });
    upstreamCompleted = true;
    upstreamStatus = response.status;
    upstreamText = await response.text();
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      upstreamStatus = 502;
      upstreamText = "Technocore is currently unreachable.";
    }
  } finally {
    clearTimeout(timeout);
  }

  const confirmed = await waitForRoomReadback(path, payload.did, payload.text);
  if (confirmed) {
    return new NextResponse(
      upstreamCompleted && upstreamStatus >= 200 && upstreamStatus < 300
        ? upstreamText || "confirmed"
        : "confirmed-after-upstream-delay",
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  if (upstreamCompleted) {
    return new NextResponse(upstreamText || `Technocore returned ${upstreamStatus}`, {
      status: upstreamStatus,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return timeoutResponse("write");
}
