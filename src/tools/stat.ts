import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { assertValidHost } from "../ssh/hosts.js";

export function registerStatTool(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  server.registerTool(
    "ssh_stat",
    {
      description: "Get metadata about a file or directory on a remote SSH host: type, size, permissions, modification time, owner/group ids.",
      inputSchema: {
        host: z.string().describe("SSH config alias of the target host"),
        path: z.string().describe("Path to inspect"),
      },
    },
    async ({ host, path }) => {
      try {
        assertValidHost(host);
        if (typeof path !== "string" || path.trim().length === 0) {
          throw new Error("path must be a non-empty string");
        }
        const conn = await manager.getConnection(host);
        const resolved = await conn.resolvePath(path);
        const stat = await conn.stat(resolved, settings.operationTimeoutMs);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `path: ${path}`,
                `type: ${stat.type}`,
                `size: ${stat.size} bytes`,
                `permissions: ${stat.permissions}`,
                `modified: ${stat.modifiedAt}`,
                `uid: ${stat.uid}`,
                `gid: ${stat.gid}`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to stat "${path}" on host "${host}":\n${message}` }],
        };
      }
    },
  );
}
