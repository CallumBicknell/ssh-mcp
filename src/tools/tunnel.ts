import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Settings } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import type { TunnelManager } from "../ssh/tunnels.js";
import { assertValidHost } from "../ssh/hosts.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(prefix: string, host: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${prefix} on host "${host}":\n${message}` }],
  };
}

export function registerTunnelTools(
  server: McpServer,
  manager: ConnectionManager,
  _settings: Settings,
  tunnels: TunnelManager,
): void {
  server.registerTool(
    "ssh_tunnel",
    {
      description:
        "Start a persistent local port-forward through the pooled SSH connection for `host`, e.g. forward local port 8080 to snow:80. The tunnel stays open until ssh_tunnel_stop is called. Returns the tunnel id and the local URL to use.",
      inputSchema: {
        host: z.string().describe("SSH config alias to tunnel through"),
        localPort: z.number().int().min(0).max(65535).describe("Local port to listen on (0 = random)"),
        remoteHost: z.string().default("127.0.0.1").describe("Destination host from the SSH server's perspective"),
        remotePort: z.number().int().min(1).max(65535).describe("Destination port"),
        localHost: z.string().default("127.0.0.1").describe("Local bind address"),
      },
    },
    async ({ host, localPort, remoteHost, remotePort, localHost }) => {
      try {
        assertValidHost(host);
        const conn = await manager.getConnection(host);
        const tunnel = await tunnels.start(conn, host, localHost, localPort, remoteHost, remotePort);
        return ok(
          `Tunnel started:\nid: ${tunnel.id}\nlocal: ${tunnel.localHost}:${tunnel.localPort}\nforwards to: ${tunnel.remoteHost}:${tunnel.remotePort} (via "${tunnel.host}")`,
        );
      } catch (err) {
        return fail("Failed to start tunnel", host, err);
      }
    },
  );

  server.registerTool(
    "ssh_tunnels",
    {
      description: "List currently open SSH port-forward tunnels.",
      inputSchema: {},
    },
    async () => {
      const list = tunnels.list();
      if (list.length === 0) return ok("No open tunnels.");
      return ok(
        list.map((t) => `${t.id}: ${t.localHost}:${t.localPort} -> ${t.remoteHost}:${t.remotePort} (via "${t.host}")`).join("\n"),
      );
    },
  );

  server.registerTool(
    "ssh_tunnel_stop",
    {
      description: "Stop a port-forward tunnel by id (from ssh_tunnel / ssh_tunnels).",
      inputSchema: {
        id: z.string().describe("Tunnel id to stop"),
      },
    },
    async ({ id }) => {
      const stopped = tunnels.stop(id);
      return stopped ? ok(`Tunnel "${id}" stopped.`) : { isError: true, content: [{ type: "text" as const, text: `No tunnel found with id "${id}".` }] };
    },
  );
}
