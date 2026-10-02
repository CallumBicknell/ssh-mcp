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
  operationTimeoutMs: 1000,
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

  it("shares a single connection across concurrent requests for the same host", async () => {
    let created = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      created++;
      await gate;
      return fakeConnection();
    });
    const p1 = manager.getConnection("web");
    const p2 = manager.getConnection("web");
    const p3 = manager.getConnection("web");
    release();
    const [c1, c2, c3] = await Promise.all([p1, p2, p3]);
    expect(created).toBe(1);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
  });

  it("does not evict an actively used connection on idle timeout", async () => {
    let closed = 0;
    const active = { count: 1 };
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      return {
        isAlive: () => true,
        get activeOperations() {
          return active.count;
        },
        close: () => {
          closed++;
        },
      } as unknown as SshConnection;
    });
    await manager.getConnection("web");
    await sleep(100); // > idleTimeoutMs, but the connection is "busy"
    expect(closed).toBe(0);
    expect(manager.activeHosts()).toEqual(["web"]);
    active.count = 0;
    await sleep(100);
    expect(closed).toBe(1);
    expect(manager.activeHosts()).toEqual([]);
  });

  it("closes a connection that was superseded during closeAll", async () => {
    let closed = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ConnectionManager(SETTINGS, CONFIG, async () => {
      await gate;
      return {
        isAlive: () => true,
        close: () => {
          closed++;
        },
      } as unknown as SshConnection;
    });
    const pending = manager.getConnection("web");
    const closing = manager.closeAll();
    release();
    await expect(pending).rejects.toThrow(/closed during establishment/);
    await closing;
    expect(closed).toBe(1);
    expect(manager.activeHosts()).toEqual([]);
  });
});
