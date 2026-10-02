import { describe, expect, it, vi } from "vitest";
import { SshConnection } from "./connection.js";

describe("SshConnection SFTP subsystem reuse", () => {
  it("opens one SFTP channel and reuses it across file operations", async () => {
    let opened = 0;
    const fakeSftp = { on: () => {} };
    const fakeClient = {
      on: () => {},
      sftp: vi.fn((cb: (err: Error | undefined, sftp: unknown) => void) => {
        opened += 1;
        cb(undefined, fakeSftp);
      }),
    };
    const conn = new SshConnection(fakeClient as never);
    // Two concurrent acquisitions must share the same pending channel.
    await Promise.all([
      (conn as unknown as { getSftp: () => Promise<unknown> }).getSftp(),
      (conn as unknown as { getSftp: () => Promise<unknown> }).getSftp(),
    ]);
    await (conn as unknown as { getSftp: () => Promise<unknown> }).getSftp();
    expect(opened).toBe(1);
  });

  it("reopens the SFTP channel after the previous one closed", async () => {
    let opened = 0;
    const handlers: Record<string, (() => void)[]> = {};
    const fakeSftp = {
      on: (event: string, cb: () => void) => {
        (handlers[event] ??= []).push(cb);
      },
    };
    const fakeClient = {
      on: () => {},
      sftp: vi.fn((cb: (err: Error | undefined, sftp: unknown) => void) => {
        opened += 1;
        cb(undefined, fakeSftp);
      }),
    };
    const conn = new SshConnection(fakeClient as never);
    const access = conn as unknown as { getSftp: () => Promise<unknown> };
    await access.getSftp();
    // Simulate the SFTP channel dying.
    handlers["close"]?.[0]?.();
    await access.getSftp();
    expect(opened).toBe(2);
  });
});
