import { describe, expect, it } from "vitest";
import { errorMessage, formatCommandError, formatConnectionError } from "./errors.js";

describe("errorMessage", () => {
  it("extracts message from Error and stringifies others", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("formatConnectionError", () => {
  it("includes host and reason", () => {
    const out = formatConnectionError("snow", new Error("Connection refused"));
    expect(out).toContain("SSH connection failed:");
    expect(out).toContain("host: snow");
    expect(out).toContain("reason: Connection refused");
  });
});

describe("formatCommandError", () => {
  it("includes exit code and stderr", () => {
    const out = formatCommandError("snow", { exitCode: 1 }, "Unit nginx.service could not be found.");
    expect(out).toContain("exit code: 1");
    expect(out).toContain("stderr:");
    expect(out).toContain("Unit nginx.service could not be found.");
  });

  it("describes timeouts", () => {
    const out = formatCommandError("snow", { exitCode: null, timedOut: true }, "");
    expect(out).toContain("timed out");
  });
});
