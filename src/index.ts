#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findConfigPath, loadSshConfig } from "./config/ssh-config.js";
import { loadSettings } from "./config/settings.js";
import { ConnectionManager } from "./ssh/manager.js";
import { registerTools } from "./tools/register.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const settings = loadSettings();
  const configPath = findConfigPath();
  const config = loadSshConfig(configPath);
  if (!config) {
    // Not fatal: the error will surface clearly when a tool is called.
    console.error(`ssh-mcp: warning: no SSH config found at ${configPath}`);
  }

  const manager = new ConnectionManager(settings, config);
  const server = new McpServer({ name: "ssh-mcp", version: VERSION });
  registerTools(server, manager, settings);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ssh-mcp ${VERSION}: running on stdio`);

  const shutdown = () => {
    void manager.closeAll().finally(() => {
      void server.close().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("ssh-mcp: fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
