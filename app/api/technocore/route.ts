import { NextRequest, NextResponse } from "next/server";

const ORIGIN = "https://technocore.chat";
const ALLOWED_PREFIXES = ["/r/", "/kv/", "/rooms", "/healthz", "/.well-known/"];
const UPSTREAM_TIMEOUT_MS = 15000;

function profileProofCompatibility(path: string): { upstreamPath: string; syntheticWrite: boolean } | null {
  const match = path.match(/^\/kv\/did-([0-9a-f]{2})\/([0-9a-f]{14})(?:\/set\/.*)?$/i);
  if (!match) return null;

  const fingerprint = `${match[1]}${match[2]}`.toLowerCase();
  return {
    upstreamPath: `/r/proof-${fingerprint}?format=json&limit=200&n=${Date.now()}`,
    syntheticWrite: path.includes("/set/"),
  };
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  if (!requestedPath.startsWith("/") || !ALLOWED_PREFIXES.some((prefix) => requestedPath.startsWith(prefix))) {
    return new NextResponse("Unsupported Technocore path.", { status: 400 });
  }

  // Legacy profile-index compatibility:
  // Agent profiles are now canonical only when the DID-signed profile message can
  // be read back from proof-<fingerprint>. The old /kv/did-* index is not allowed
  // to block onboarding because the rest of the console already verifies profiles
  // from signed proof rooms. Existing callers can keep using didNotePath while this
  // bridge routes reads to the signed proof source and treats index writes as no-op.
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
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

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
    if (error instanceof Error && error.name === "AbortError") {
      return new NextResponse(
        "Technocore request timed out after 15 seconds. Nothing was confirmed by the console. Retry when the upstream service responds.",
        { status: 504 },
      );
    }
    return new NextResponse("Technocore is currently unreachable.", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
