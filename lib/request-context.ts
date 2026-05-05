import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type RequestHeaders = Pick<Headers, "get">;

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export const requestIdHeaderName = "x-request-id";

export function getCurrentRequestId() {
  return requestContext.getStore()?.requestId ?? null;
}

export function getOrCreateRequestId(headers: RequestHeaders) {
  const requestId = headers.get(requestIdHeaderName)?.trim();
  return requestId || randomUUID();
}

export function runWithRequestContext<T>(
  requestHeaders: RequestHeaders,
  callback: (requestId: string) => T,
) {
  const requestId = getOrCreateRequestId(requestHeaders);
  return requestContext.run({ requestId }, () => callback(requestId));
}
