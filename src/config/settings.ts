export interface Settings {
  /** Maximum number of bytes kept per output stream before truncation. */
  maxOutputBytes: number;
  /** Default timeout for remote commands. */
  commandTimeoutMs: number;
  /** Timeout for establishing an SSH connection. */
  connectionTimeoutMs: number;
  /** How long an idle pooled connection is kept open. */
  idleTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  maxOutputBytes: 64 * 1024,
  commandTimeoutMs: 30_000,
  connectionTimeoutMs: 10_000,
  idleTimeoutMs: 120_000,
};

const ENV_KEYS: Record<keyof Settings, string> = {
  maxOutputBytes: "SSH_MCP_MAX_OUTPUT",
  commandTimeoutMs: "SSH_MCP_COMMAND_TIMEOUT",
  connectionTimeoutMs: "SSH_MCP_CONNECTION_TIMEOUT",
  idleTimeoutMs: "SSH_MCP_IDLE_TIMEOUT",
};

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, envName] of Object.entries(ENV_KEYS) as [keyof Settings, string][]) {
    const raw = env[envName];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid value for ${envName}: "${raw}" (expected a positive number)`);
    }
    settings[key] = Math.floor(value);
  }
  return settings;
}
