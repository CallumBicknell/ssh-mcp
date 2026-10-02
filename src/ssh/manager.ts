import SSHConfig from "ssh-config";
import type { Settings } from "../config/settings.js";
import { resolveHost, type ResolvedHost } from "../config/ssh-config.js";
import { SshConnection } from "./connection.js";
import { assertValidHost } from "./hosts.js";

export type ConnectFn = (resolved: ResolvedHost, connectionTimeoutMs: number) => Promise<SshConnection>;

interface PooledEntry {
  connection?: SshConnection;
  pending?: Promise<SshConnection>;
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
      if (existing.pending) {
        // A connection attempt for this host is already in flight — share it
        // instead of opening a duplicate connection.
        return existing.pending;
      }
      if (existing.connection && existing.connection.isAlive()) {
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
    const entry: PooledEntry = {};
    this.connections.set(host, entry);
    let resolved: ResolvedHost;
    try {
      resolved = resolveHost(this.config, host);
    } catch (err) {
      this.connections.delete(host);
      throw new Error(
        `Invalid SSH configuration for host "${host}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const pending = this.connect(resolved, this.settings.connectionTimeoutMs);
    entry.pending = pending;
    try {
      const connection = await pending;
      if (this.connections.get(host) !== entry) {
        // The pool was torn down (closeAll/remove) while we were connecting.
        connection.close();
        throw new Error(`Connection to host "${host}" was closed during establishment.`);
      }
      entry.connection = connection;
      entry.pending = undefined;
      this.armIdleTimer(host, entry);
      return connection;
    } catch (err) {
      if (this.connections.get(host) === entry) {
        this.connections.delete(host);
      }
      if (err instanceof Error && err.message.includes("closed during establishment")) {
        throw err;
      }
      throw new Error(
        `SSH connection failed for host "${host}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private armIdleTimer(host: string, entry: PooledEntry): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const connection = entry.connection;
      if (connection && connection.activeOperations > 0) {
        // A command/SFTP operation is still running — defer eviction.
        this.armIdleTimer(host, entry);
        return;
      }
      connection?.close();
      if (this.connections.get(host) === entry) {
        this.connections.delete(host);
      }
    }, this.settings.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  remove(host: string): void {
    const entry = this.connections.get(host);
    if (entry) {
      clearTimeout(entry.idleTimer);
      entry.connection?.close();
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
