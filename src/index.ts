#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findConfigPath, loadSshConfig } from "./config/ssh-config.js";
import { loadSettings } from "./config/settings.js";
import { ConnectionManager } from "./ssh/manager.js";
import { TunnelManager } from "./ssh/tunnels.js";
import { registerTools } from "./tools/register.js";

const VERSION = "0.2.1";

function handleFlags(): boolean {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(`ssh-mcp ${VERSION}`);
    return true;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `ssh-mcp ${VERSION}\n\nRun as an MCP stdio server. Environment variables:\n  SSH_MCP_MAX_OUTPUT, SSH_MCP_COMMAND_TIMEOUT, SSH_MCP_CONNECTION_TIMEOUT,\n  SSH_MCP_OPERATION_TIMEOUT, SSH_MCP_IDLE_TIMEOUT, SSH_CONFIG_PATH\n\nOptions:\n  --version, -v   print version and exit\n  --help, -h      print this help and exit`,
    );
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  if (handleFlags()) return;
  const settings = loadSettings();
  const configPath = findConfigPath();
  const config = loadSshConfig(configPath);
  if (!config) {
    // Not fatal: the error will surface clearly when a tool is called.
    console.error(`ssh-mcp: warning: no SSH config found at ${configPath}`);
  }

  const manager = new ConnectionManager(settings, config);
  const tunnels = new TunnelManager();
  const server = new McpServer({ name: "ssh-mcp", version: VERSION });
  registerTools(server, manager, settings, config, tunnels);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ssh-mcp ${VERSION}: running on stdio`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("ssh-mcp: shutting down");
    // Never let a stuck close hang the process forever.
    const force = setTimeout(() => process.exit(1), 3000);
    force.unref();
    try {
      tunnels.stopAll();
    } catch {
      // Already gone.
    }
    void manager
      .closeAll()
      .catch(() => {})
      .then(() => server.close())
      .catch(() => {})
      .finally(() => {
        clearTimeout(force);
        process.exit(0);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("ssh-mcp: fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
