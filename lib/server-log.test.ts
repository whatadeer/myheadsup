import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "./request-context";
import { logServerExternalRequest, logServerRequest } from "./server-log";

const originalNodeEnv = process.env.NODE_ENV;
const originalAccessLogs = process.env.ACCESS_LOGS;
const logTimestamp = "2026-05-08T20:15:00.000Z";

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  restoreEnv("ACCESS_LOGS", originalAccessLogs);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("logServerRequest", () => {
  it("logs requests in production by default", () => {
    process.env.NODE_ENV = "production";
    restoreEnv("ACCESS_LOGS", undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logServerRequest("http-request", {
      method: "GET",
      nextUrl: {
        pathname: "/api/dashboard",
        search: "?force=true",
      },
      requestId: "req-123",
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "[myheadsup:http-request:info]",
      JSON.stringify({
        timestamp: logTimestamp,
        message: "Incoming request",
        hasSearch: true,
        method: "GET",
        pathname: "/api/dashboard",
        requestId: "req-123",
      }),
    );
  });

  it("does not log requests in development by default", () => {
    process.env.NODE_ENV = "development";
    restoreEnv("ACCESS_LOGS", undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logServerRequest("http-request", {
      method: "GET",
      nextUrl: {
        pathname: "/",
        search: "",
      },
      requestId: "req-123",
    });

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("allows request logging to be disabled explicitly", () => {
    process.env.NODE_ENV = "production";
    process.env.ACCESS_LOGS = "false";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logServerRequest("http-request", {
      method: "POST",
      nextUrl: {
        pathname: "/api/gitlab/references",
        search: "",
      },
      requestId: "req-123",
    });

    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("logServerExternalRequest", () => {
  it("logs external requests in production by default", () => {
    process.env.NODE_ENV = "production";
    restoreEnv("ACCESS_LOGS", undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logServerExternalRequest("gitlab-request", {
      baseUrl: "https://gitlab.example.com",
      method: "POST",
      path: "/projects/1/pipeline_schedules/2/play",
      status: 201,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "[myheadsup:gitlab-request:info]",
      JSON.stringify({
        timestamp: logTimestamp,
        message: "Outgoing request completed",
        baseUrl: "https://gitlab.example.com",
        method: "POST",
        path: "/projects/1/pipeline_schedules/2/play",
        status: 201,
      }),
    );
  });

  it("includes the active request id in correlated logs", () => {
    process.env.NODE_ENV = "production";
    restoreEnv("ACCESS_LOGS", undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    runWithRequestContext(
      {
        get(name: string) {
          return name === "x-request-id" ? "req-456" : null;
        },
      },
      () => {
        logServerExternalRequest("gitlab-request", {
          baseUrl: "https://gitlab.example.com",
          method: "GET",
          path: "/projects",
          status: 200,
        });
      },
    );

    expect(infoSpy).toHaveBeenCalledWith(
      "[myheadsup:gitlab-request:info]",
      JSON.stringify({
        timestamp: logTimestamp,
        message: "Outgoing request completed",
        requestId: "req-456",
        baseUrl: "https://gitlab.example.com",
        method: "GET",
        path: "/projects",
        status: 200,
      }),
    );
  });

  it("does not log external requests when access logs are disabled", () => {
    process.env.NODE_ENV = "production";
    process.env.ACCESS_LOGS = "false";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(logTimestamp));

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logServerExternalRequest("sonarqube-request", {
      baseUrl: "https://sonar.example.com",
      method: "GET",
      path: "/api/qualitygates/project_status?projectKey=demo",
      status: 200,
    });

    expect(infoSpy).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === "string") {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}
