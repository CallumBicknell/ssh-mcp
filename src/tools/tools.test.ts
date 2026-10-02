import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../config/settings.js";
import type { ConnectionManager } from "../ssh/manager.js";
import { TunnelManager } from "../ssh/tunnels.js";
import { registerTools } from "./register.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
}>;

interface RegisteredTool {
  name: string;
  config: { description?: string };
  handler: Handler;
}

function makeServer() {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool: vi.fn((name: string, config: unknown, handler: Handler) => {
      tools.push({ name, config: config as { description?: string }, handler });
    }),
  };
  return { server, tools };
}

function makeManager(conn: Record<string, unknown>): ConnectionManager {
  return {
    getConnection: vi.fn(async () => conn),
  } as unknown as ConnectionManager;
}

describe("registerTools", () => {
  it("registers all four tools", () => {
    const { server, tools } = makeServer();
    const manager = makeManager({});
    registerTools(server as never, manager, DEFAULT_SETTINGS, null, new TunnelManager());
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ssh_exec",
      "ssh_hosts",
      "ssh_list_directory",
      "ssh_read_file",
      "ssh_stat",
      "ssh_tunnel",
      "ssh_tunnel_stop",
      "ssh_tunnels",
      "ssh_write_file",
    ]);
  });
});

describe("ssh_exec handler", () => {
  function setup(result: Record<string, unknown>) {
    const { server, tools } = makeServer();
    const conn = { exec: vi.fn(async () => result) };
    const manager = makeManager(conn);
    registerTools(server as never, manager, DEFAULT_SETTINGS, null, new TunnelManager());
    const tool = tools.find((t) => t.name === "ssh_exec")!;
    return { tool, conn, manager };
  }

  it("returns stdout and exit code on success", async () => {
    const { tool } = setup({
      stdout: "CONTAINER ID\nabc123\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
    const res = await tool.handler({ host: "snow", command: "docker ps" });
    expect(res.isError).toBe(false);
    expect(res.content[0]!.text).toContain("exit code: 0");
    expect(res.content[0]!.text).toContain("CONTAINER ID");
  });

  it("flags non-zero exit codes as errors", async () => {
    const { tool } = setup({
      stdout: "",
      stderr: "Unit nginx.service could not be found.",
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: 1,
      signal: null,
      timedOut: false,
    });
    const res = await tool.handler({ host: "snow", command: "systemctl status nginx" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("exit code: 1");
    expect(res.content[0]!.text).toContain("Unit nginx.service could not be found.");
  });

  it("reports timeouts", async () => {
    const { tool } = setup({
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: null,
      signal: null,
      timedOut: true,
    });
    const res = await tool.handler({ host: "snow", command: "sleep 999" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("timed out");
  });

  it("rejects invalid hosts without touching SSH", async () => {
    const { tool, manager } = setup({});
    const res = await tool.handler({ host: "bad host; rm -rf /", command: "id" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Invalid host identifier/);
    expect(manager.getConnection).not.toHaveBeenCalled();
  });
});

describe("ssh_read_file handler", () => {
  it("returns file contents and truncation notice", async () => {
    const { server, tools } = makeServer();
    const conn = { resolvePath: async (p: string) => p, readFile: vi.fn(async () => ({ text: "file body", truncated: true, bytes: 9 })) };
    registerTools(server as never, makeManager(conn), DEFAULT_SETTINGS, null, new TunnelManager());
    const tool = tools.find((t) => t.name === "ssh_read_file")!;
    const res = await tool.handler({ host: "snow", path: "/etc/hostname" });
    expect(res.content[0]!.text).toContain("file body");
    expect(res.content[0]!.text).toContain("truncated");
  });
});

describe("ssh_write_file handler", () => {
  it("writes and reports success", async () => {
    const { server, tools } = makeServer();
    const conn = { resolvePath: async (p: string) => p, writeFile: vi.fn(async () => {}) };
    registerTools(server as never, makeManager(conn), DEFAULT_SETTINGS, null, new TunnelManager());
    const tool = tools.find((t) => t.name === "ssh_write_file")!;
    const res = await tool.handler({ host: "snow", path: "/tmp/x", content: "hello" });
    expect(res.isError).toBeFalsy();
    expect(conn.writeFile).toHaveBeenCalledWith("/tmp/x", "hello", DEFAULT_SETTINGS.operationTimeoutMs);
  });

  it("surfaces write errors", async () => {
    const { server, tools } = makeServer();
    const conn = { resolvePath: async (p: string) => p, writeFile: vi.fn(async () => Promise.reject(new Error("No such file or directory"))) };
    registerTools(server as never, makeManager(conn), DEFAULT_SETTINGS, null, new TunnelManager());
    const tool = tools.find((t) => t.name === "ssh_write_file")!;
    const res = await tool.handler({ host: "snow", path: "/no/such/dir/x", content: "hi" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("No such file or directory");
  });
});

describe("ssh_list_directory handler", () => {
  it("formats entries compactly", async () => {
    const { server, tools } = makeServer();
    const conn = { resolvePath: async (p: string) => p,
      listDirectory: vi.fn(async () => [
        { name: "etc", type: "directory", size: 4096, modifiedAt: "2026-01-01T00:00:00.000Z", mode: 0o40755 },
        { name: "hosts", type: "file", size: 220, modifiedAt: "2026-01-01T00:00:00.000Z", mode: 0o100644 },
      ]),
    };
    registerTools(server as never, makeManager(conn), DEFAULT_SETTINGS, null, new TunnelManager());
    const tool = tools.find((t) => t.name === "ssh_list_directory")!;
    const res = await tool.handler({ host: "snow", path: "/" });
    const text = res.content[0]!.text;
    expect(text).toContain("2 entries");
    expect(text).toContain("directory");
    expect(text).toContain("hosts");
  });
});
