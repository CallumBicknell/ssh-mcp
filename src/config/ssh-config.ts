import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import SSHConfig, { parse } from "ssh-config";

export interface ResolvedHost {
  alias: string;
  host: string;
  port: number;
  username?: string;
  identityFiles: string[];
  agent?: string;
}

export function defaultConfigPath(): string {
  return path.join(homedir(), ".ssh", "config");
}

export function findConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SSH_CONFIG_PATH ?? defaultConfigPath();
}

export function loadSshConfig(configPath: string = findConfigPath()): SSHConfig | null {
  if (!existsSync(configPath)) return null;
  return parse(readFileSync(configPath, "utf8"));
}

function asString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

export function resolveHost(config: SSHConfig, alias: string): ResolvedHost {
  const computed = config.compute(alias);
  const hostName = asString(computed.HostName) ?? alias;
  const portRaw = asString(computed.Port);
  const port = portRaw !== undefined ? Number(portRaw) : 22;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid Port "${portRaw}" for host "${alias}"`);
  }
  return {
    alias,
    host: hostName,
    port,
    username: asString(computed.User),
    identityFiles: asStringArray(computed.IdentityFile).map(expandHome),
    agent: asString(computed.IdentityAgent),
  };
}
