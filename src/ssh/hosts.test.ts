import { describe, expect, it } from "vitest";
import { assertValidHost, isValidHost } from "./hosts.js";

describe("isValidHost", () => {
  it("accepts typical aliases", () => {
    expect(isValidHost("snow")).toBe(true);
    expect(isValidHost("server01")).toBe(true);
    expect(isValidHost("home-server")).toBe(true);
    expect(isValidHost("desktop.local")).toBe(true);
    expect(isValidHost("user_host~1")).toBe(true);
  });

  it("rejects empty, non-string and dangerous values", () => {
    expect(isValidHost("")).toBe(false);
    expect(isValidHost("   ")).toBe(false);
    expect(isValidHost(undefined)).toBe(false);
    expect(isValidHost(null)).toBe(false);
    expect(isValidHost(42)).toBe(false);
    expect(isValidHost("-oProxyCommand=evil")).toBe(false);
    expect(isValidHost("host;rm -rf /")).toBe(false);
    expect(isValidHost("host name")).toBe(false);
    expect(isValidHost("$(whoami)")).toBe(false);
  });
});

describe("assertValidHost", () => {
  it("throws with a useful message", () => {
    expect(() => assertValidHost("bad host")).toThrow(/Invalid host identifier/);
    expect(() => assertValidHost("")).toThrow(/Invalid host identifier/);
  });
});
