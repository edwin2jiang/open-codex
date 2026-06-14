# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch.

## Reporting

Do not open a public issue for a vulnerability. Use GitHub private vulnerability
reporting for this repository.

Include the affected version, operating system, reproduction steps, impact, and
any suggested mitigation. Never include real credentials, private source code,
or access tokens.

## Threat model

Open Codex launches an agent that can read files, propose changes, and run
commands. Treat model output, repository content, tool output, web content, MCP
servers, and generated patches as untrusted input.

The secure default is local-only stdio transport, workspace-scoped writes,
network disabled, and user approval for elevated actions. The GUI must never
silently broaden the sandbox selected by the user.
