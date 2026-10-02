import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { assertValidHost } from "../ssh/hosts.js";

export function registerListDirectoryTool(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  server.registerTool(
    "ssh_list_directory",
    {
      description: "List the contents of a directory on a remote SSH host (defaults to the remote user's home directory). Each entry includes type, size, permission bits and modification time.",
      inputSchema: {
        host: z.string().describe("SSH config alias of the target host"),
        path: z.string().optional().describe("Directory path (defaults to the remote user's home directory)"),
      },
    },
    async ({ host, path }) => {
      try {
        assertValidHost(host);
        const conn = await manager.getConnection(host);
        const target = path === undefined || path.trim().length === 0 ? "." : await conn.resolvePath(path);
        const entries = await conn.listDirectory(target, settings.operationTimeoutMs);
        if (entries.length === 0) {
          return { content: [{ type: "text" as const, text: `(empty directory: ${target})` }] };
        }
        const lines = entries.map((e) => {
          const perms = `${(e.mode & 0o777).toString(8).padStart(4, "0")}`;
          return `${e.type.padEnd(9)} ${String(e.size).padStart(8)} ${e.modifiedAt} ${perms} ${e.name}`;
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `${entries.length} entries in ${target}:\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to list directory "${path ?? "."}" on host "${host}":\n${message}` }],
        };
      }
    },
  );
}
