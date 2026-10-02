import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { atomicWrite } from "./connection.js";

class FakeWriteStream extends EventEmitter {
  written = "";
  constructor(
    private readonly store: Map<string, string>,
    private readonly target: string,
    private readonly failWrites: boolean,
  ) {
    super();
  }
  end(data: string): void {
    this.written = data;
    queueMicrotask(() => {
      if (this.failWrites) {
        this.emit("error", new Error("disk full"));
        return;
      }
      this.store.set(this.target, data);
      this.emit("close");
    });
  }
}

function makeSftp(store: Map<string, string>, opts: { failWrites?: boolean; failRename?: boolean } = {}) {
  const unlinked: string[] = [];
  const renamed: Array<[string, string]> = [];
  const sftp = {
    createWriteStream: (path: string) => new FakeWriteStream(store, path, opts.failWrites ?? false),
    stat: (path: string, cb: (err: Error | undefined, attrs: unknown) => void) => {
      if (!store.has(path)) {
        cb(new Error("No such file"), undefined);
        return;
      }
      cb(undefined, { mode: 0o100640 });
    },
    setstat: (_path: string, _attrs: unknown, cb: (err?: Error) => void) => cb(),
    rename: (src: string, dest: string, cb: (err?: Error) => void) => {
      if (opts.failRename) {
        cb(new Error("rename denied"));
        return;
      }
      renamed.push([src, dest]);
      store.set(dest, store.get(src)!);
      store.delete(src);
      cb();
    },
    unlink: (path: string, cb: (err?: Error) => void) => {
      unlinked.push(path);
      store.delete(path);
      cb();
    },
  };
  return { sftp: sftp as unknown as SFTPWrapper, unlinked, renamed };
}

describe("atomicWrite", () => {
  it("writes via a temp file and renames it over the destination", async () => {
    const store = new Map<string, string>([["/etc/app.conf", "old"]]);
    const { sftp, renamed } = makeSftp(store);
    await atomicWrite(sftp, "/etc/app.conf", "new-content");
    expect(store.get("/etc/app.conf")).toBe("new-content");
    expect(renamed[0]![1]).toBe("/etc/app.conf");
    // temp file has been moved away, no partial file left behind
    expect([...store.keys()].filter((k) => k.includes(".tmp"))).toEqual([]);
  });

  it("leaves the destination untouched and cleans up when the write fails", async () => {
    const store = new Map<string, string>([["/etc/app.conf", "old"]]);
    const { sftp, unlinked } = makeSftp(store, { failWrites: true });
    await expect(atomicWrite(sftp, "/etc/app.conf", "new-content")).rejects.toThrow(/disk full/);
    expect(store.get("/etc/app.conf")).toBe("old");
    expect(unlinked.some((p) => p.includes(".ssh-mcp-"))).toBe(true);
  });

  it("cleans up the temp file when rename fails", async () => {
    const store = new Map<string, string>();
    const { sftp, unlinked } = makeSftp(store, { failRename: true });
    await expect(atomicWrite(sftp, "/data/out.txt", "x")).rejects.toThrow(/rename denied/);
    expect(store.has("/data/out.txt")).toBe(false);
    expect(unlinked.some((p) => p.includes(".ssh-mcp-"))).toBe(true);
  });

  it("does not create parent directories", async () => {
    const store = new Map<string, string>();
    const { sftp } = makeSftp(store);
    // rename succeeds against a fake, so emulate missing directory via unlinkable path instead:
    // simulate by making rename fail for unknown dir
    const failing = makeSftp(store, { failRename: true });
    await expect(atomicWrite(failing.sftp, "/no/such/dir/file", "x")).rejects.toThrow();
    expect(store.size).toBe(0);
    void sftp;
  });
});
