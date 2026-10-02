import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { registerExecTool } from "./exec.js";
import { registerListDirectoryTool } from "./list-directory.js";
import { registerReadFileTool } from "./read-file.js";
import { registerWriteFileTool } from "./write-file.js";

export function registerTools(server: McpServer, manager: ConnectionManager, settings: Settings): void {
  registerExecTool(server, manager, settings);
  registerReadFileTool(server, manager, settings);
  registerWriteFileTool(server, manager, settings);
  registerListDirectoryTool(server, manager, settings);
}
