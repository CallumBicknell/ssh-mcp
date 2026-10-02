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
  private active = 0;

  /** Number of in-flight exec/SFTP operations on this connection. */
  get activeOperations(): number {
    return this.active;
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.active += 1;
    return operation().finally(() => {
      this.active -= 1;
    });
  }

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
    return this.track(
      () =>
        new Promise<ExecResult>((resolve, reject) => {
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
            // Ask the remote process to terminate, then give up on the channel.
            try {
              channel?.signal("KILL");
            } catch {
              // ignore — channel may already be gone
            }
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
        }),
    );
  }

  readFile(path: string, maxBytes: number, timeoutMs: number): Promise<CappedOutput> {
    return this.track(() =>
      withTimeout(
        new Promise<CappedOutput>((resolve, reject) => {
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
        }),
        timeoutMs,
      ),
    );
  }

  writeFile(path: string, content: string, timeoutMs: number): Promise<void> {
    return this.track(() =>
      withTimeout(
        new Promise<void>((resolve, reject) => {
          this.client.sftp((err, sftp) => {
            if (err) {
              reject(err);
              return;
            }
            atomicWrite(sftp, path, content).then(resolve, reject);
          });
        }),
        timeoutMs,
      ),
    );
  }

  listDirectory(dirPath: string, timeoutMs: number): Promise<DirEntry[]> {
    return this.track(() =>
      withTimeout(
        new Promise<DirEntry[]>((resolve, reject) => {
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
        }),
        timeoutMs,
      ),
    );
  }

  stat(path: string, timeoutMs: number): Promise<FileStat> {
    return this.track(() =>
      withTimeout(
        new Promise<FileStat>((resolve, reject) => {
          this.client.sftp((err, sftp) => {
            if (err) {
              reject(err);
              return;
            }
            sftp.stat(path, (err2, attrs) => {
              if (err2) {
                reject(err2);
                return;
              }
              let type: DirEntryType = "other";
              if (attrs.isFile()) type = "file";
              else if (attrs.isDirectory()) type = "directory";
              else if (attrs.isSymbolicLink()) type = "symlink";
              resolve({
                type,
                size: attrs.size,
                modifiedAt: new Date(attrs.mtime * 1000).toISOString(),
                mode: attrs.mode,
                permissions: (attrs.mode & 0o7777).toString(8).padStart(4, "0"),
                uid: attrs.uid,
                gid: attrs.gid,
              });
            });
          });
        }),
        timeoutMs,
      ),
    );
  }
}

export interface FileStat {
  type: DirEntryType;
  size: number;
  modifiedAt: string;
  mode: number;
  permissions: string;
  uid: number;
  gid: number;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`SFTP operation timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    operation.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );
  });
}

function sftpStat(sftp: import("ssh2").SFTPWrapper, path: string): Promise<import("ssh2").Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, attrs) => (err ? reject(err) : resolve(attrs)));
  });
}

function sftpSetstat(sftp: import("ssh2").SFTPWrapper, path: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.setstat(path, { mode }, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpRename(sftp: import("ssh2").SFTPWrapper, src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(src, dest, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpUnlink(sftp: import("ssh2").SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Writes via a temporary file in the same directory, then renames it over the
 * destination. A failed write therefore leaves the original file untouched
 * and no partial content is ever visible at the destination path.
 */
export async function atomicWrite(
  sftp: import("ssh2").SFTPWrapper,
  path: string,
  content: string,
): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const tmpPath = `${dir}/.${base}.ssh-mcp-${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;

  // Preserve the existing file's permission bits where possible.
  let existingMode: number | undefined;
  try {
    const attrs = await sftpStat(sftp, path);
    existingMode = attrs.mode & 0o7777;
  } catch {
    existingMode = undefined;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(tmpPath, { flags: "w" });
      stream.on("error", reject);
      stream.on("close", () => resolve());
      stream.end(content, "utf8");
    });
    if (existingMode !== undefined) {
      try {
        await sftpSetstat(sftp, tmpPath, existingMode);
      } catch {
        // Non-fatal: destination keeps the temporary file's permissions.
      }
    }
    await sftpRename(sftp, tmpPath, path);
  } catch (err) {
    try {
      await sftpUnlink(sftp, tmpPath);
    } catch {
      // Temp file may not exist; nothing to clean up.
    }
    throw err;
  }
}

export { capOutput };
