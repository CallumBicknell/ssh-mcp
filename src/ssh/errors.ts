export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function formatConnectionError(host: string, err: unknown): string {
  return `SSH connection failed:\nhost: ${host}\nreason: ${errorMessage(err)}`;
}

export interface CommandErrorInfo {
  exitCode: number | null;
  signal?: string | null;
  timedOut?: boolean;
}

export function formatCommandError(host: string, info: CommandErrorInfo, stderr: string): string {
  const lines = [`Remote command failed:`, `host: ${host}`];
  if (info.timedOut) {
    lines.push(`timed out`, `signal: ${info.signal ?? "unknown"}`);
  } else {
    lines.push(`exit code: ${info.exitCode === null ? "none" : info.exitCode}`);
    if (info.signal) lines.push(`signal: ${info.signal}`);
  }
  if (stderr.trim().length > 0) {
    lines.push(``, `stderr:`, stderr.trimEnd());
  }
  return lines.join("\n");
}
