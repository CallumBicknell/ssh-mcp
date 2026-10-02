import net from "node:net";
import type { SshConnection } from "./connection.js";

export interface Tunnel {
  id: string;
  host: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  stop: () => void;
}

let nextId = 1;

/**
 * Manages local port-forward tunnels that ride over an existing pooled SSH
 * connection. A tunnel stays open (and counts as activity, so the connection
 * is not idle-evicted) until explicitly stopped or the server shuts down.
 */
export class TunnelManager {
  private tunnels = new Map<string, Tunnel>();

  async start(
    conn: SshConnection,
    host: string,
    localHost: string,
    localPort: number,
    remoteHost: string,
    remotePort: number,
  ): Promise<Tunnel> {
    const server = net.createServer((socket) => {
      conn
        .forwardOut(remoteHost, remotePort)
        .then((stream) => {
          socket.pipe(stream).pipe(socket);
          stream.on("error", () => socket.destroy());
        })
        .catch(() => socket.destroy());
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(localPort, localHost, () => resolve());
    });

    conn.acquire();
    const address = server.address();
    const actualLocalPort = address && typeof address === "object" ? address.port : localPort;
    const tunnel: Tunnel = {
      id: `tunnel-${nextId++}`,
      host,
      localHost,
      localPort: actualLocalPort,
      remoteHost,
      remotePort,
      stop: () => {
        server.close();
        conn.release();
        this.tunnels.delete(tunnel.id);
      },
    };
    this.tunnels.set(tunnel.id, tunnel);
    return tunnel;
  }

  list(): Omit<Tunnel, "stop">[] {
    return [...this.tunnels.values()].map(({ stop: _stop, ...rest }) => rest);
  }

  stop(id: string): boolean {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return false;
    tunnel.stop();
    return true;
  }

  stopAll(): void {
    for (const tunnel of [...this.tunnels.values()]) {
      tunnel.stop();
    }
  }
}
