# Contributing

## Development setup

Requirements:

- Node.js 22+
- pnpm 11.6+
- Rust 1.85+ for the Tauri shell
- Codex CLI for live integration tests

```bash
pnpm install
pnpm schema:codex
pnpm check
pnpm dev
```

The daemon listens on `127.0.0.1:4737` by default and the Vite UI on
`127.0.0.1:1420`.

## Pull requests

Keep changes focused. Include:

- the problem and expected behavior;
- security or compatibility implications;
- tests or a clear reason tests are not applicable;
- screenshots for visible UI changes;
- the Codex CLI version used for protocol changes.

Protocol changes must include a fixture or contract test. Never commit secrets,
Codex session data, generated user transcripts, or local repository contents.
