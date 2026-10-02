import net from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { TunnelManager } from "./tunnels.js";
import type { SshConnection } from "./connection.js";

describe("TunnelManager", () => {
  it("starts a tunnel, lists it, and stops it", async () => {
    const tunnels = new TunnelManager();
    const remoteServer = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => remoteServer.listen(0, "127.0.0.1", resolve));
    const remotePort = (remoteServer.address() as net.AddressInfo).port;

    const fakeConn = {
      acquire: () => {},
      release: () => {},
      forwardOut: async (_host: string, _port: number) => {
        const socket = net.connect(remotePort, "127.0.0.1");
        return socket as unknown as import("stream").Duplex;
      },
    } as unknown as SshConnection;

    const tunnel = await tunnels.start(fakeConn, "web", "127.0.0.1", 0, "127.0.0.1", remotePort);
    expect(tunnels.list()).toHaveLength(1);
    expect(tunnel.localPort).toBeGreaterThan(0);

    // Data round-trips through the tunnel.
    const client = net.connect(tunnel.localPort, "127.0.0.1");
    await once(client, "connect");
    client.write("ping");
    const response = await once(client, "data");
    expect(response[0].toString()).toBe("ping");
    client.destroy();

    expect(tunnels.stop(tunnel.id)).toBe(true);
    expect(tunnels.list()).toHaveLength(0);
    remoteServer.close();
  });
});
