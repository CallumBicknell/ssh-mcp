import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { assertValidHost } from "../ssh/hosts.js";
import { formatCommandError } from "../ssh/errors.js";

export function registerExecTool(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  server.registerTool(
    "ssh_exec",
    {
      description:
        "Execute a command on a remote SSH host (identified by its alias in ~/.ssh/config). Returns stdout, stderr, exit code, and whether the command timed out or output was truncated.",
      inputSchema: {
        host: z.string().describe("SSH config alias of the target host"),
        command: z.string().describe("Command to execute on the remote host"),
        timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Timeout in milliseconds (default: ${settings.commandTimeoutMs})`),
      },
    },
    async ({ host, command, timeout }) => {
      try {
        assertValidHost(host);
        if (typeof command !== "string" || command.trim().length === 0) {
          throw new Error("command must be a non-empty string");
        }
        const conn = await manager.getConnection(host);
        const result = await conn.exec(command, timeout ?? settings.commandTimeoutMs, settings.maxOutputBytes);
        if (result.timedOut) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: formatCommandError(host, { exitCode: null, timedOut: true }, result.stderr) +
                  (result.stdout ? `\n\npartial stdout:\n${result.stdout}` : ""),
              },
            ],
          };
        }
        const parts = [`exit code: ${result.exitCode === null ? "none (killed by signal " + (result.signal ?? "?") + ")" : result.exitCode}`];
        if (result.signal) parts.push(`signal: ${result.signal}`);
        parts.push(``, `stdout:`, result.stdout || "(empty)");
        if (result.stdoutTruncated) parts.push(`[stdout truncated at ${settings.maxOutputBytes} bytes]`);
        if (result.stderr.length > 0) {
          parts.push(``, `stderr:`, result.stderr);
          if (result.stderrTruncated) parts.push(`[stderr truncated at ${settings.maxOutputBytes} bytes]`);
        }
        return {
          isError: result.exitCode !== 0,
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `SSH exec failed on host "${host}":\n${message}` }],
        };
      }
    },
  );
}
