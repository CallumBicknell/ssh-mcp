import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Client, type ConnectConfig } from "ssh2";
import type { ResolvedHost } from "../config/ssh-config.js";
import { capOutput, OutputCapper, type CappedOutput } from "../utils/output.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export type DirEntryType = "file" | "directory" | "symlink" | "other";

export interface DirEntry {
  name: string;
  type: DirEntryType;
  size: number;
  modifiedAt: string;
  mode: number;
}

function resolveAgentPath(agent: string | undefined): string | undefined {
  const raw = agent === undefined || agent === "SSH_AUTH_SOCK" ? process.env.SSH_AUTH_SOCK : agent;
  if (!raw || raw === "none") return undefined;
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return path.join(homedir(), raw.slice(2));
  return raw;
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /auth/i.test(msg);
}

function connectOnce(config: ConnectConfig): Promise<SshConnection> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const onError = (err: Error) => reject(err);
    client.once("error", onError);
    client.once("ready", () => {
      client.removeListener("error", onError);
      resolve(new SshConnection(client));
    });
    client.connect(config);
  });
}

function authAttempts(resolved: ResolvedHost, readyTimeout: number): ConnectConfig[] {
  const base: ConnectConfig = {
    host: resolved.host,
    port: resolved.port,
    username: resolved.username,
    readyTimeout,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
  };
  const attempts: ConnectConfig[] = [];
  const agentPath = resolveAgentPath(resolved.agent);
  if (agentPath) {
    attempts.push({ ...base, agent: agentPath });
  }
  for (const keyPath of resolved.identityFiles) {
    try {
      attempts.push({ ...base, privateKey: readFileSync(keyPath) });
    } catch {
      // Unreadable key file — skip it; other auth methods may still work.
    }
  }
  if (attempts.length === 0) {
    attempts.push(base);
  }
  return attempts;
}

export class SshConnection {
  private closed = false;

  constructor(private readonly client: Client) {
    client.on("close", () => {
      this.closed = true;
    });
    client.on("error", () => {
      this.closed = true;
    });
  }

  static async connect(resolved: ResolvedHost, connectionTimeoutMs: number): Promise<SshConnection> {
    let lastError: unknown;
    for (const config of authAttempts(resolved, connectionTimeoutMs)) {
      try {
        return await connectOnce(config);
      } catch (err) {
        lastError = err;
        if (!isAuthError(err)) throw err;
      }
    }
    throw lastError;
  }

  isAlive(): boolean {
    return !this.closed;
  }

  close(): void {
    this.closed = true;
    try {
      this.client.end();
    } catch {
      // already gone
    }
  }

  exec(command: string, timeoutMs: number, maxOutputBytes: number): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const stdout = new OutputCapper(maxOutputBytes);
      const stderr = new OutputCapper(maxOutputBytes);
      let timedOut = false;
      let settled = false;
      let channel: import("ssh2").ClientChannel | undefined;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          channel?.close();
        } catch {
          // ignore
        }
        finish(() =>
          resolve({
            stdout: stdout.result().text,
            stderr: stderr.result().text,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            exitCode: null,
            signal: null,
            timedOut: true,
          }),
        );
      }, timeoutMs);

      this.client.exec(command, (err, ch) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        channel = ch;
        ch.on("data", (data: Buffer) => stdout.push(data));
        ch.stderr.on("data", (data: Buffer) => stderr.push(data));
        ch.on("close", (code: number | undefined, signal: string | undefined) => {
          finish(() =>
            resolve({
              stdout: stdout.result().text,
              stderr: stderr.result().text,
              stdoutTruncated: stdout.truncated,
              stderrTruncated: stderr.truncated,
              exitCode: code ?? null,
              signal: signal ?? null,
              timedOut,
            }),
          );
        });
        ch.on("error", (e: Error) => finish(() => reject(e)));
      });
    });
  }

  readFile(path: string, maxBytes: number): Promise<CappedOutput> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        const capper = new OutputCapper(maxBytes);
        const stream = sftp.createReadStream(path);
        stream.on("data", (data: Buffer) => capper.push(data));
        stream.on("error", reject);
        stream.on("end", () => resolve(capper.result()));
      });
    });
  }

  writeFile(path: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        const stream = sftp.createWriteStream(path, { flags: "w" });
        stream.on("error", reject);
        stream.on("close", () => resolve());
        stream.end(content, "utf8");
      });
    });
  }

  listDirectory(dirPath: string): Promise<DirEntry[]> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        sftp.readdir(dirPath, (err2, list) => {
          if (err2) {
            reject(err2);
            return;
          }
          resolve(
            list.map((entry): DirEntry => {
              const attrs = entry.attrs;
              let type: DirEntryType = "other";
              if (attrs.isFile()) type = "file";
              else if (attrs.isDirectory()) type = "directory";
              else if (attrs.isSymbolicLink()) type = "symlink";
              return {
                name: entry.filename,
                type,
                size: attrs.size,
                modifiedAt: new Date(attrs.mtime * 1000).toISOString(),
                mode: attrs.mode,
              };
            }),
          );
        });
      });
    });
  }
}

export { capOutput };
