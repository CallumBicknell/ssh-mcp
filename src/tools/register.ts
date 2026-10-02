import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type SSHConfig from "ssh-config";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import type { TunnelManager } from "../ssh/tunnels.js";
import { registerExecTool } from "./exec.js";
import { registerHostsTool } from "./hosts.js";
import { registerListDirectoryTool } from "./list-directory.js";
import { registerReadFileTool } from "./read-file.js";
import { registerStatTool } from "./stat.js";
import { registerTunnelTools } from "./tunnel.js";
import { registerWriteFileTool } from "./write-file.js";

export function registerTools(
  server: McpServer,
  manager: ConnectionManager,
  settings: Settings,
  config: SSHConfig | null,
  tunnels: TunnelManager,
): void {
  registerExecTool(server, manager, settings);
  registerReadFileTool(server, manager, settings);
  registerWriteFileTool(server, manager, settings);
  registerListDirectoryTool(server, manager, settings);
  registerHostsTool(server, manager, settings, config);
  registerStatTool(server, manager, settings);
  registerTunnelTools(server, manager, settings, tunnels);
}
