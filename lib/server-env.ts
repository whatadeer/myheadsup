import { loadEnvConfig } from "@next/env";

let envLoaded = false;

export function getServerEnvValue(name: string) {
  if (!envLoaded) {
    loadEnvConfig(process.cwd());
    envLoaded = true;
  }

  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}
