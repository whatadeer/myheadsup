import { getCurrentRequestId } from "./request-context";

type LogContext = Record<string, unknown>;

export function logServerError(scope: string, error: unknown, context?: LogContext) {
  const requestContext = getRequestLogContext();
  console.error(
    formatLogPrefix(scope, "error"),
    JSON.stringify({
      timestamp: getLogTimestamp(),
      ...(requestContext ?? {}),
      ...(context ?? {}),
      error: serializeError(error),
    }),
  );
}

export function logServerDebug(scope: string, message: string, context?: LogContext) {
  if (!isDebugDashboardLoggingEnabled()) {
    return;
  }

  writeInfoLog(scope, "debug", message, context);
}

export function logServerInfo(scope: string, message: string, context?: LogContext) {
  writeInfoLog(scope, "info", message, context);
}

function writeInfoLog(
  scope: string,
  level: "debug" | "info",
  message: string,
  context?: LogContext,
) {
  const requestContext = getRequestLogContext();
  console.info(
    formatLogPrefix(scope, level),
    JSON.stringify({
      timestamp: getLogTimestamp(),
      message,
      ...(requestContext ?? {}),
      ...(context ?? {}),
    }),
  );
}

export function logServerRequest(
  scope: string,
  request: {
    method: string;
    requestId: string;
    nextUrl: {
      pathname: string;
      search: string;
    };
  },
) {
  if (!isAccessLoggingEnabled()) {
    return;
  }

  logServerInfo(scope, "Incoming request", {
    hasSearch: request.nextUrl.search.length > 0,
    method: request.method,
    pathname: request.nextUrl.pathname,
    requestId: request.requestId,
  });
}

export function logServerExternalRequest(
  scope: string,
  request: {
    baseUrl: string;
    method: string;
    path: string;
    status: number;
  },
) {
  if (!isAccessLoggingEnabled()) {
    return;
  }

  logServerInfo(scope, "Outgoing request completed", request);
}

function formatLogPrefix(scope: string, level: "debug" | "error" | "info") {
  return `[myheadsup:${scope}:${level}]`;
}

function getLogTimestamp() {
  return new Date().toISOString();
}

function isAccessLoggingEnabled() {
  const accessLogs = normalizeBooleanEnv(process.env.ACCESS_LOGS);
  if (accessLogs !== null) {
    return accessLogs;
  }

  return process.env.NODE_ENV === "production";
}

function isDebugDashboardLoggingEnabled() {
  return normalizeBooleanEnv(process.env.DEBUG_DASHBOARD) === true;
}

function normalizeBooleanEnv(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  return null;
}

function getRequestLogContext() {
  const requestId = getCurrentRequestId();
  if (!requestId) {
    return null;
  }

  return { requestId };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
