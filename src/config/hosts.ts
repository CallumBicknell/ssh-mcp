import type { SSHConfig } from "ssh-config";

/**
 * Returns the concrete host aliases defined in the SSH config. Wildcard and
 * negated patterns (e.g. `*`, `*.example.com`, `!secret`) are excluded since
 * they are not connectable targets by name.
 */
export function listHostAliases(config: SSHConfig): string[] {
  const aliases: string[] = [];
  for (const line of config) {
    const candidate = line as { param?: string; value?: string | { val: string }[] };
    if (candidate.param !== "Host") continue;
    const tokens =
      typeof candidate.value === "string"
        ? candidate.value.split(/\s+/)
        : (candidate.value ?? []).map((v) => (typeof v === "string" ? v : v.val));
    for (const token of tokens) {
      const t = token.trim();
      if (t.length === 0) continue;
      if (t.includes("*") || t.includes("?") || t.startsWith("!")) continue;
      aliases.push(t);
    }
  }
  return [...new Set(aliases)].sort();
}
