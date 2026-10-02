const HOST_PATTERN = /^[A-Za-z0-9._~][A-Za-z0-9._~-]*$/;

/**
 * Validates an SSH host identifier. The value is always a config alias or
 * hostname resolved through the SSH config — it is never interpolated into a
 * local shell command.
 */
export function isValidHost(host: unknown): host is string {
  return (
    typeof host === "string" &&
    host.length > 0 &&
    host.length <= 255 &&
    !host.startsWith("-") &&
    HOST_PATTERN.test(host)
  );
}

export function assertValidHost(host: unknown): asserts host is string {
  if (!isValidHost(host)) {
    throw new Error(
      `Invalid host identifier: ${typeof host === "string" ? JSON.stringify(host) : typeof host}. ` +
        `Expected a non-empty SSH config alias (letters, digits, '.', '_', '~', '-').`,
    );
  }
}
