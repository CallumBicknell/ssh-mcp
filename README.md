# ssh-mcp

`ssh-mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI agents safe, structured access to remote machines over SSH. Instead of hand-assembling `ssh snow "docker ps"` commands, the agent calls typed tools like `ssh_exec({host: "snow", command: "docker ps"})` and gets back stdout, stderr, exit code, timeout and truncation information.

```text
AI Agent
   │  MCP / stdio
   ▼
ssh-mcp
   │  SSH (connection pool, your OpenSSH config/credentials)
   ▼
Remote machines
```

**The MCP server has essentially the same remote privileges as the SSH identity in use.** Only connect it to agents you trust, on machines you are comfortable granting shell access to.

## Requirements

- Node.js >= 20
- An SSH configuration you already use (`~/.ssh/config`) with working credentials

## Installation

From npm (once published):

```bash
npm install -g @callumbicknell/ssh-mcp
```

From source:

```bash
git clone https://github.com/CallumBicknell/ssh-mcp.git
cd ssh-mcp
pnpm install
pnpm run build
```

## SSH configuration

`ssh-mcp` discovers hosts from your existing OpenSSH client config — `~/.ssh/config` by default, or `SSH_CONFIG_PATH` if set. Nothing is duplicated: hostnames, users, ports and key paths all come from the file the `ssh` CLI already uses.

Per host, it resolves: `HostName`, `Port`, `User`, `IdentityFile` (tried in order), and `IdentityAgent`/`SSH_AUTH_SOCK`. Agent auth is preferred when available, then identity files.

## MCP client configuration

Local/source usage:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/path/to/ssh-mcp/dist/index.js"]
    }
  }
}
```

npm usage (after publishing/installing):

```json
{
  "mcpServers": {
    "ssh": {
      "command": "npx",
      "args": ["-y", "@callumbicknell/ssh-mcp"]
    }
  }
}
```

The server speaks MCP on **stdio**; all logs go to **stderr**.

## Tools

| Tool | Purpose |
| --- | --- |
| `ssh_hosts` | List the concrete host aliases available in your SSH config (no secrets) |
| `ssh_exec` | Run a remote command; returns stdout/stderr/exit code/timeout/truncation |
| `ssh_read_file` | Read a remote text file (size-capped) |
| `ssh_write_file` | Atomically write a remote file (temp file + rename; never creates parent dirs) |
| `ssh_list_directory` | Compact directory listing with type, size, mode, mtime |
| `ssh_stat` | File/dir metadata: type, size, permissions, mtime, uid/gid |

### `ssh_exec` result shape

```text
exit code: 0

stdout:
...

stderr:
...
[stdout truncated at 65536 bytes]   ← only when truncated
```

Non-zero exit codes and stderr are always surfaced as MCP errors/text; timeouts return partial output plus a clear timeout message. On timeout the remote process is sent `KILL` and the channel is closed.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SSH_MCP_MAX_OUTPUT` | `65536` | Max bytes kept per output stream before truncation |
| `SSH_MCP_COMMAND_TIMEOUT` | `30000` | Default `ssh_exec` timeout (ms) |
| `SSH_MCP_CONNECTION_TIMEOUT` | `10000` | SSH connection timeout (ms) |
| `SSH_MCP_OPERATION_TIMEOUT` | `30000` | Per-operation SFTP timeout (ms) |
| `SSH_MCP_IDLE_TIMEOUT` | `120000` | How long an idle pooled connection is kept (ms) |
| `SSH_CONFIG_PATH` | `~/.ssh/config` | Path to the OpenSSH client config |

Timeout semantics: connection timeout bounds establishing the TCP/SSH session; command timeout bounds a single `ssh_exec`; operation timeout bounds one SFTP read/write/stat/readdir; idle timeout only evicts a connection with **no active operations**.

## SSH compatibility limitations

`ssh-mcp` uses the [`ssh2`](https://www.npmjs.com/package/ssh2) library plus a parser for `~/.ssh/config`. It is **not** a full OpenSSH client:

| Supported | Not supported (or approximate) |
| --- | --- |
| `HostName`, `Port`, `User` | `ProxyCommand` (not honored) |
| `IdentityFile` (multiple) | `ProxyJump` (not honored) |
| `IdentityAgent` / `SSH_AUTH_SOCK` | `Match` blocks (not evaluated) |
| Per-host aliases | `LocalForward`/`RemoteForward`, `ControlMaster`, `PermitLocalCommand`, `CertificateFile` agent quirks |
| Agent and publickey auth | Password prompts (no interactive prompting — use keys/agent) |

For hosts that require jump hosts or proxy commands, either add direct `HostName`/`Port` entries you can reach, or front them with a reachable bastion address in your config. Switching to shelling out to the system `ssh` binary was evaluated and rejected: it would lose connection pooling, structured results, and make timeout/output control and atomic-write SFTP impossible to guarantee portably.

## Security model

- No command allowlist by design: the server is an administration tool, and a blanket allowlist would make it useless for that purpose. Command-policy/confirmation middleware is a clear extension point.
- Private keys/passwords are read by `ssh2` during auth only; they are never logged or returned.
- Host identifiers are validated and never interpolated into a local shell.
- All output is byte-capped; all operations are timeout-bounded.
- File writes are atomic and do not create parent directories.

## Examples

```text
ssh_hosts()
→ snow\nserver01\nfileserver

ssh_exec({host: "snow", command: "docker ps --format '{{.Names}} {{.Status}}'"})
ssh_read_file({host: "snow", path: "/etc/caddy/Caddyfile"})
ssh_write_file({host: "snow", path: "/tmp/deploy.yaml", content: "..."})
ssh_list_directory({host: "snow", path: "~/stacks"})
ssh_stat({host: "snow", path: "/etc/nginx/nginx.conf"})
```

## Development

```bash
pnpm install        # install
pnpm run dev        # rebuild on change (tsc --watch)
pnpm run build      # emit to dist/
pnpm run typecheck  # strict type check
pnpm test           # vitest — no real SSH server required
pnpm start          # run on stdio
```

Tests mock the SSH/SFTP layer; they validate host parsing, validation, truncation (including UTF-8 edge cases), timeout logic, atomic write failure handling, connection-pool behaviour under concurrency, error formatting, and tool registration. CI runs install/typecheck/test/build on Node 22, 24 and 26.

## Publishing

Package name on npm: `@callumbicknell/ssh-mcp` (the unscoped `ssh-mcp` name is owned by another project).

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs typecheck + tests + build automatically. `npm pack --dry-run` shows that only `dist/`, `README.md` and `LICENSE` ship.
