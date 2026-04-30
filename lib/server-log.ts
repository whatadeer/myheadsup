type LogContext = Record<string, unknown>;

const debugDashboardLoggingEnabled = process.env.DEBUG_DASHBOARD === "true";

export function logServerError(scope: string, error: unknown, context?: LogContext) {
  console.error(
    formatLogPrefix(scope, "error"),
    JSON.stringify({
      ...(context ?? {}),
      error: serializeError(error),
    }),
  );
}

export function logServerDebug(scope: string, message: string, context?: LogContext) {
  if (!debugDashboardLoggingEnabled) {
    return;
  }

  console.info(
    formatLogPrefix(scope, "debug"),
    JSON.stringify({
      message,
      ...(context ?? {}),
    }),
  );
}

function formatLogPrefix(scope: string, level: "debug" | "error") {
  return `[myheadsup:${scope}:${level}]`;
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
