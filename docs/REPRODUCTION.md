# Reproduction Guide

This guide reproduces the current Open Codex vertical slice from a clean clone.

## 1. Prerequisites

- Git
- Node.js 22 or newer
- pnpm 11.6 or newer
- Rust and platform Tauri dependencies for the native shell
- Codex CLI with `app-server` support

Check:

```bash
git --version
node --version
pnpm --version
rustc --version
codex --version
codex app-server --help
```

The repository baseline on 2026-06-14 was verified with
`codex-cli 0.140.0-alpha.2`. The latest stable upstream release at that date was
`rust-v0.139.0`. Do not assume these remain current; always run the commands
above.

## 2. Clone and install

```bash
git clone https://github.com/edwin2jiang/open-codex.git
cd open-codex
pnpm install --frozen-lockfile
```

## 3. Verify Codex authentication

Use the official Codex login flow:

```bash
codex login
```

Open Codex never asks you to place an API key in this repository.

## 4. Generate protocol bindings

```bash
pnpm schema:codex
```

This runs:

```bash
codex app-server generate-ts --out generated/codex-schema
```

The generated directory is intentionally ignored by Git because it is specific
to the local Codex version. Contract fixtures committed later will be pinned and
reviewed separately.

## 5. Run the no-token smoke test

```bash
pnpm smoke:codex
```

Expected shape:

```json
{
  "ok": true,
  "version": "codex-cli ...",
  "auth": {
    "type": "chatgpt",
    "planType": "plus",
    "required": true
  }
}
```

Authentication type and plan category differ by login mode. The smoke command
does not print account email or tokens. It initializes app-server and reads
account state; it does not start a model turn.

## 6. Run checks

```bash
pnpm check
pnpm build
```

## 7. Run the web development UI

```bash
pnpm dev
```

Open `http://127.0.0.1:1420`.

1. Enter the absolute path to a local Git repository.
2. Select **New thread**.
3. Enter a bounded task.
4. Press **Run task** or `Cmd/Ctrl+Enter`.
5. Review approval dialogs before accepting.

The current alpha uses your configured Codex model and may consume account
usage when a turn is started.

## 8. Run the Tauri shell

Start the daemon in one terminal:

```bash
pnpm dev:daemon
```

Then:

```bash
pnpm --filter @open-codex/desktop tauri dev
```

Production sidecar packaging is not implemented yet.

## 9. Troubleshooting

`codex: command not found`:

- install the official Codex CLI;
- or set `CODEX_BIN` to an absolute binary path.

Handshake timeout:

- run `codex app-server --help`;
- inspect stderr with `OPEN_CODEX_DEBUG=1`;
- regenerate the schema and compare the installed version.

UI says disconnected:

- verify `curl http://127.0.0.1:4737/health`;
- check that another process is not using port 4737;
- set `OPEN_CODEX_PORT` and matching `VITE_OPEN_CODEX_DAEMON_URL`.

Approval is stuck:

- do not restart repeatedly;
- capture the method and request id from diagnostics;
- unknown server requests intentionally fail closed.

## 10. Clean-room verification

Before a release:

1. Create a clean VM for each target platform.
2. Install only documented prerequisites.
3. Clone the tagged commit.
4. Verify lockfile installation.
5. Generate protocol bindings.
6. Run unit, contract, integration, and packaging tests.
7. Compare checksums with CI artifacts.
8. Run the fixed task suite in disposable repositories.
9. Confirm no user credentials or transcripts entered the artifact.
