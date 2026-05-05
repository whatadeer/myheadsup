import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getOrCreateRequestId, requestIdHeaderName } from "@/lib/request-context";
import { logServerRequest } from "@/lib/server-log";

export function proxy(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(requestIdHeaderName, requestId);

  logServerRequest("http-request", {
    method: request.method,
    nextUrl: request.nextUrl,
    requestId,
  });

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(requestIdHeaderName, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.[^/]+$).*)"],
};
