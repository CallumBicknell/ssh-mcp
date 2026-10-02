import { describe, expect, it } from "vitest";
import { parse } from "ssh-config";
import type { Settings } from "../config/settings.js";
import type { SshConnection } from "./connection.js";
import { ConnectionManager } from "./manager.js";

const CONFIG = parse("Host web\n    HostName web.example.com\n");

const SETTINGS: Settings = {
  maxOutputBytes: 1024,
  commandTimeoutMs: 1000,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 50,
};

function fakeConnection(alive = true): SshConnection {
  return {
    isAlive: () => alive,
    close: () => {},
  } as unknown as SshConnection;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ConnectionManager", () => {
  it("reuses a live connection for the same host", async () => {
    let created = 0;
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      created++;
      return fakeConnection();
    });
    const a = await manager.getConnection("web");
    const b = await manager.getConnection("web");
    expect(a).toBe(b);
    expect(created).toBe(1);
  });

  it("reconnects when the existing connection is dead", async () => {
    let created = 0;
    let firstAlive = true;
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      created++;
      return {
        isAlive: () => (created === 1 ? firstAlive : true),
        close: () => {},
      } as unknown as SshConnection;
    });
    await manager.getConnection("web");
    firstAlive = false;
    await manager.getConnection("web");
    expect(created).toBe(2);
  });

  it("closes idle connections after the idle timeout", async () => {
    let closed = 0;
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      return {
        isAlive: () => true,
        close: () => {
          closed++;
        },
      } as unknown as SshConnection;
    });
    await manager.getConnection("web");
    expect(manager.activeHosts()).toEqual(["web"]);
    await sleep(100);
    expect(closed).toBe(1);
    expect(manager.activeHosts()).toEqual([]);
  });

  it("rejects invalid host identifiers", async () => {
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => fakeConnection());
    await expect(manager.getConnection("bad host")).rejects.toThrow(/Invalid host identifier/);
  });

  it("fails clearly when no SSH config is available", async () => {
    const manager = new ConnectionManager(SETTINGS, null, async () => fakeConnection());
    await expect(manager.getConnection("web")).rejects.toThrow(/No SSH client configuration/);
  });

  it("closeAll closes everything", async () => {
    let closed = 0;
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      return {
        isAlive: () => true,
        close: () => {
          closed++;
        },
      } as unknown as SshConnection;
    });
    await manager.getConnection("web");
    await manager.closeAll();
    expect(closed).toBe(1);
    expect(manager.activeHosts()).toEqual([]);
  });
});
