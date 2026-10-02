import { describe, expect, it } from "vitest";
import { parse } from "ssh-config";
import { resolveHost } from "./ssh-config.js";

const CONFIG = parse(`
Host web
    HostName web.example.com
    User deploy
    Port 2222
    IdentityFile ~/.ssh/web_key

Host plain
    HostName 10.0.0.5
`);

describe("resolveHost", () => {
  it("resolves all fields from the config", () => {
    const host = resolveHost(CONFIG, "web");
    expect(host.host).toBe("web.example.com");
    expect(host.username).toBe("deploy");
    expect(host.port).toBe(2222);
    expect(host.identityFiles).toHaveLength(1);
    expect(host.identityFiles[0]).toMatch(/web_key$/);
    expect(host.identityFiles[0]).not.toContain("~");
  });

  it("falls back to alias and port 22", () => {
    const host = resolveHost(CONFIG, "unknown-host");
    expect(host.host).toBe("unknown-host");
    expect(host.port).toBe(22);
    expect(host.identityFiles).toEqual([]);
  });

  it("uses HostName as host when present", () => {
    const host = resolveHost(CONFIG, "plain");
    expect(host.host).toBe("10.0.0.5");
    expect(host.port).toBe(22);
  });

  it("rejects invalid ports", () => {
    const bad = parse("Host x\n    Port notaport\n");
    expect(() => resolveHost(bad, "x")).toThrow(/Port/);
  });
});
