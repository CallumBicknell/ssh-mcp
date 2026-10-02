# ssh-mcp

`ssh-mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI agents interact with remote machines over SSH. The agent calls tools like `ssh_exec("snow", "docker ps")` and `ssh-mcp` takes care of connecting, authenticating, pooling, timeouts and truncating output.

The agent never needs to know the IP address, username, port or private key — those come from your normal OpenSSH configuration.

```text
AI Agent
   ↓
ssh_exec("snow", "docker ps")
   ↓
ssh-mcp
   ↓
SSH
   ↓
snow
```

## Requirements

- Node.js >= 20
- pnpm (used for development; any npm-compatible client works for consumption)
- Working SSH credentials for the target hosts (key-based auth recommended)

## Installation

```bash
npm install -g ssh-mcp
```

or build from source:

```bash
git clone https://github.com/CallumBicknell/ssh-mcp.git
cd ssh-mcp
pnpm install
pnpm run build
```

## How SSH configuration is discovered

`ssh-mcp` reads your existing OpenSSH client config — by default `~/.ssh/config` (override with the `SSH_CONFIG_PATH` environment variable). For each tool call it resolves the host alias through that config, including:

- `HostName`, `Port`, `User`
- `IdentityFile` (tried in order)
- `IdentityAgent` / `SSH_AUTH_SOCK` (agent auth is tried first when available)

Example `~/.ssh/config`:

```sshconfig
Host snow
    HostName 192.168.1.50
    User callum

Host server01
    HostName 10.0.0.20
    User root
```

You can then refer to `snow` or `server01` from any tool call. Nothing is duplicated, and no secrets are stored in this project.

**Limitations:** `ssh-config`/`ssh2` do not implement every OpenSSH directive. Notably, complex `ProxyCommand`/`ProxyJump` chains and `Match` blocks may not behave exactly like the `ssh` CLI. For exotic setups, add a plain `HostName`/`Port` entry for the machines you want to reach.

## Running the server

```bash
node dist/index.js
```

or, when installed globally, `ssh-mcp`. The server speaks MCP over **stdio**. Logs go to **stderr** (stdout is reserved for the protocol).

## Configuring an MCP client

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ssh": {
      "command": "ssh-mcp"
    }
  }
}
```

If running from a source checkout:

```json
{
  "mcpServers": {
    "ssh": {
      "command": "node",
      "args": ["/home/you/ssh-mcp/dist/index.js"]
    }
  }
}
```

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "ssh": {
      "type": "local",
      "command": ["node", "/home/you/ssh-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

## Tools

### `ssh_exec`

Execute a command on a remote host.

Arguments: `host: string`, `command: string`, `timeout?: number` (ms)

Returns stdout, stderr, exit code, signal, whether the command timed out, and whether either stream was truncated. Non-zero exit codes and stderr are always surfaced to the agent (as MCP errors where appropriate).

### `ssh_read_file`

Read a remote text file. Arguments: `host: string`, `path: string`.

### `ssh_write_file`

Write text to a remote file. Arguments: `host: string`, `path: string`, `content: string`.

Parent directories are **not** created automatically; failures surface clearly.

### `ssh_list_directory`

List a remote directory. Arguments: `host: string`, `path?: string`. Returns a compact listing with name, type, size, permission bits and modification time.

## Configuration via environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SSH_MCP_MAX_OUTPUT` | `65536` | Max bytes kept per output stream (stdout/stderr/file content) before truncation |
| `SSH_MCP_COMMAND_TIMEOUT` | `30000` | Default command timeout in ms |
| `SSH_MCP_CONNECTION_TIMEOUT` | `10000` | Connection timeout in ms |
| `SSH_MCP_IDLE_TIMEOUT` | `120000` | How long a pooled connection stays open unused |
| `SSH_CONFIG_PATH` | `~/.ssh/config` | Path to the OpenSSH client config |

## Example agent interactions

```text
User: Check if nginx is running on snow
Agent: ssh_exec(host="snow", command="systemctl is-active nginx")
→ exit code: 0
  stdout: active
```

```text
User: Show me the docker containers on server01
Agent: ssh_exec(host="server01", command="docker ps --format 'table {{.Names}}\t{{.Status}}'")
```

```text
User: Read /etc/hosts from snow
Agent: ssh_read_file(host="snow", path="/etc/hosts")
```

```text
User: Deploy this config to snow
Agent: ssh_write_file(host="snow", path="/etc/myapp/config.yaml", content="...")
```

## Security considerations

This server intentionally gives an agent significant power over your machines. In practice:

- Only deploy it where you trust the agent/model you connect. There is deliberately **no command allowlist** in the initial version.
- Private keys and passwords are read from your system, never logged, and never returned in tool results.
- Host identifiers are validated (`~ /^[A-Za-z0-9._~-]+$/`-style aliases, never interpreted by a local shell).
- Remote command execution happens over the SSH protocol; no local shell interpolation is used anywhere in the request path.
- Output sizes and timeouts are bounded to avoid unbounded memory or context growth.

The architecture leaves a clear seam for future command-policy/confirmation middleware around `ssh_exec`.

## Development

```bash
pnpm install        # install dependencies
pnpm run typecheck  # strict TypeScript check
pnpm run build      # emit to dist/
pnpm run test       # vitest (no network required)
pnpm start          # run the server on stdio
```

Tests cover argument validation, output truncation, timeout logic, host validation, error formatting, tool registration and the connection pool — all without requiring a real SSH server.

## Adding another SSH host

Add a `Host` block to `~/.ssh/config`:

```sshconfig
Host home-server
    HostName 203.0.113.10
    User ubuntu
    IdentityFile ~/.ssh/home_server_key
```

No changes to `ssh-mcp` are needed; `"home-server"` is now usable as a host alias in every tool.
