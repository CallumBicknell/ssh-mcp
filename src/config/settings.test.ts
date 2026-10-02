import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "./settings.js";

describe("loadSettings", () => {
  it("returns defaults when no env vars are set", () => {
    expect(loadSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("reads overrides from the environment", () => {
    const settings = loadSettings({
      SSH_MCP_MAX_OUTPUT: "1024",
      SSH_MCP_COMMAND_TIMEOUT: "5000",
      SSH_MCP_CONNECTION_TIMEOUT: "3000",
      SSH_MCP_IDLE_TIMEOUT: "1000",
    });
    expect(settings).toEqual({
      maxOutputBytes: 1024,
      commandTimeoutMs: 5000,
      connectionTimeoutMs: 3000,
      operationTimeoutMs: 30000,
      idleTimeoutMs: 1000,
    });
  });

  it("rejects non-numeric and non-positive values", () => {
    expect(() => loadSettings({ SSH_MCP_MAX_OUTPUT: "abc" })).toThrow(/SSH_MCP_MAX_OUTPUT/);
    expect(() => loadSettings({ SSH_MCP_COMMAND_TIMEOUT: "-5" })).toThrow(/SSH_MCP_COMMAND_TIMEOUT/);
    expect(() => loadSettings({ SSH_MCP_IDLE_TIMEOUT: "0" })).toThrow(/SSH_MCP_IDLE_TIMEOUT/);
  });
});
