import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type SSHConfig from "ssh-config";
import type { ConnectionManager } from "../ssh/manager.js";
import type { Settings } from "../config/settings.js";
import { listHostAliases } from "../config/hosts.js";

export function registerHostsTool(server: McpServer, _manager: ConnectionManager, _settings: Settings, config: SSHConfig | null): void {
  server.registerTool(
    "ssh_hosts",
    {
      description:
        "List the SSH host aliases available in the local SSH client configuration (~/.ssh/config). Use these aliases as the `host` argument to the other ssh tools. Does not expose keys, usernames' credentials, or secrets.",
      inputSchema: {},
    },
    async () => {
      if (!config) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "No SSH client configuration found. Expected ~/.ssh/config (or SSH_CONFIG_PATH) to exist.",
            },
          ],
        };
      }
      const aliases = listHostAliases(config);
      if (aliases.length === 0) {
        return { content: [{ type: "text" as const, text: "No concrete host aliases found in the SSH config." }] };
      }
      return {
        content: [{ type: "text" as const, text: aliases.join("\n") }],
      };
    },
  );
}
