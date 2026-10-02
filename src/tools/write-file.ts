import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { assertValidHost } from "../ssh/hosts.js";

export function registerWriteFileTool(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  server.registerTool(
    "ssh_write_file",
    {
      description:
        "Write text to a file on a remote SSH host. Parent directories are NOT created automatically; the operation fails if the directory does not exist.",
      inputSchema: {
        host: z.string().describe("SSH config alias of the target host"),
        path: z.string().describe("Absolute or relative path of the file to write"),
        content: z.string().describe("Text content to write"),
      },
    },
    async ({ host, path, content }) => {
      try {
        assertValidHost(host);
        if (typeof path !== "string" || path.trim().length === 0) {
          throw new Error("path must be a non-empty string");
        }
        if (typeof content !== "string") {
          throw new Error("content must be a string");
        }
        const conn = await manager.getConnection(host);
        await conn.writeFile(path, content);
        return {
          content: [
            {
              type: "text" as const,
              text: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path} on host "${host}".`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to write file "${path}" on host "${host}":\n${message}` }],
        };
      }
    },
  );
}
