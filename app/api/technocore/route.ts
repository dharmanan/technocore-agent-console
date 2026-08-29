import { NextRequest, NextResponse } from "next/server";

const ORIGIN = "https://technocore.chat";
const ALLOWED_PREFIXES = ["/r/", "/kv/", "/rooms", "/healthz", "/.well-known/"];
const UPSTREAM_TIMEOUT_MS = 15000;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || "";
  if (!path.startsWith("/") || !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return new NextResponse("Unsupported Technocore path.", { status: 400 });
  }

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
      return new NextResponse("Technocore request timed out after 15 seconds. Nothing was confirmed by the console. Retry when the upstream service responds.", { status: 504 });
    }
    return new NextResponse("Technocore is currently unreachable.", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
