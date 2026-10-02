import SSHConfig from "ssh-config";
import type { Settings } from "../config/settings.js";
import { resolveHost, type ResolvedHost } from "../config/ssh-config.js";
import { SshConnection } from "./connection.js";
import { assertValidHost } from "./hosts.js";

export type ConnectFn = (resolved: ResolvedHost, connectionTimeoutMs: number) => Promise<SshConnection>;

interface PooledEntry {
  connection: SshConnection;
  idleTimer?: NodeJS.Timeout;
}

const defaultConnect: ConnectFn = (resolved, timeoutMs) => SshConnection.connect(resolved, timeoutMs);

export class ConnectionManager {
  private readonly connections = new Map<string, PooledEntry>();

  constructor(
    private readonly settings: Settings,
    private readonly config: SSHConfig | null,
    private readonly connect: ConnectFn = defaultConnect,
  ) {}

  async getConnection(host: string): Promise<SshConnection> {
    assertValidHost(host);
    const existing = this.connections.get(host);
    if (existing) {
      if (existing.connection.isAlive()) {
        this.armIdleTimer(host, existing);
        return existing.connection;
      }
      this.remove(host);
    }
    if (!this.config) {
      throw new Error(
        "No SSH client configuration found. Expected a config file at ~/.ssh/config (or SSH_CONFIG_PATH).",
      );
    }
    const resolved = resolveHost(this.config, host);
    const connection = await this.connect(resolved, this.settings.connectionTimeoutMs);
    const entry: PooledEntry = { connection };
    this.connections.set(host, entry);
    this.armIdleTimer(host, entry);
    return connection;
  }

  private armIdleTimer(host: string, entry: PooledEntry): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      entry.connection.close();
      this.connections.delete(host);
    }, this.settings.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  remove(host: string): void {
    const entry = this.connections.get(host);
    if (entry) {
      clearTimeout(entry.idleTimer);
      entry.connection.close();
      this.connections.delete(host);
    }
  }

  async closeAll(): Promise<void> {
    for (const host of [...this.connections.keys()]) {
      this.remove(host);
    }
  }

  activeHosts(): string[] {
    return [...this.connections.keys()];
  }
}
