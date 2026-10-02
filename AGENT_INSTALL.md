# AGENT_INSTALL.md

Instructions for an AI agent to install, configure, and verify the `ssh-mcp` MCP server on the local machine. Follow these steps directly; do not ask the user for information you can discover yourself.

## 1. Confirm prerequisites

- Node.js >= 20 (`node --version`)
- pnpm available (`pnpm --version`); if missing, run `corepack enable && corepack prepare pnpm@12.8.1 --activate`
- A working SSH config at `~/.ssh/config` (or a path in `SSH_CONFIG_PATH`) with at least one reachable host

## 2. Install

Preferred (published package):

```bash
npm install -g @callumbicknell/ssh-mcp
```

Source checkout (alternative):

```bash
git clone https://github.com/CallumBicknell/ssh-mcp.git
cd ssh-mcp
pnpm install
pnpm run build
```

## 3. Verify it starts

From a terminal:

```bash
ssh-mcp
```

It should print `ssh-mcp <version>: running on stdio` to stderr and wait. Stop it with Ctrl+C. Any other process or container can also be validated with:

```bash
npx -y @callumbicknell/ssh-mcp
```

## 4. Configure the MCP client

Detect which MCP client is being used and edit its config to add the `ssh` server entry.

- **Claude Desktop**: `~/.config/claude_desktop_config.json`
- **OpenCode**: `~/.config/opencode/opencode.json`
- **Generic**: any supported client that accepts a JSON `mcpServers` map.

Add (use `node <abs path>` from a source checkout instead of `npx` if installed from source):

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

Restart/reload the MCP client so it picks up the new server.

## 5. Smoke-test the tools

Use the client to call, in order:

```text
ssh_hosts()
ssh_stat({host: "<first-alias>", path: "~"})
ssh_exec({host: "<first-alias>", command: "hostname && uptime"})
ssh_read_file({host: "<first-alias>", path: "/etc/hostname"})
```

Expected:

- `ssh_hosts` lists aliases that are valid connectable hosts
- `ssh_stat` returns type/size/permissions/mtime/uid/gid
- `ssh_exec` returns `exit code: 0` plus stdout and empty/absent stderr
- `ssh_read_file` returns file contents

## 6. If something fails

- `SSH connection failed ...` → verify `ssh <alias> true` works from a shell first in `~/.ssh/config`
- `No SSH client configuration found` → create `~/.ssh/config` or set `SSH_CONFIG_PATH`
- `Authenticated failed` → make sure the configured key is loaded (`ssh-add -l`) or use an agent (`SSH_AUTH_SOCK`)
- Timeout → confirm the host is reachable and the chosen timeout is large enough

## 7. Done

Report to the user which tools passed the smoke test and which environment variables (if any) were needed.
