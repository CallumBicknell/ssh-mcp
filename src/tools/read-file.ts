import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { assertValidHost } from "../ssh/hosts.js";

export function registerReadFileTool(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  server.registerTool(
    "ssh_read_file",
    {
      description: "Read the contents of a text file on a remote SSH host.",
      inputSchema: {
        host: z.string().describe("SSH config alias of the target host"),
        path: z.string().describe("Absolute or relative path of the file to read"),
      },
    },
    async ({ host, path }) => {
      try {
        assertValidHost(host);
        if (typeof path !== "string" || path.trim().length === 0) {
          throw new Error("path must be a non-empty string");
        }
        const conn = await manager.getConnection(host);
        const result = await conn.readFile(path, settings.maxOutputBytes, settings.operationTimeoutMs);
        let text = result.text;
        if (result.truncated) {
          text += `\n\n[content truncated at ${settings.maxOutputBytes} bytes]`;
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to read file "${path}" on host "${host}":\n${message}` }],
        };
      }
    },
  );
}
