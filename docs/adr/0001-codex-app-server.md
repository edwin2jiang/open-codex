# ADR 0001: Use Codex app-server as the primary agent runtime

Date: 2026-06-14

Status: Accepted

## Context

The project needs a coding-agent runtime with conversation persistence,
streaming events, command and file operations, approvals, authentication, and
configuration. Implementing these capabilities independently would dominate
the schedule and security risk.

Codex CLI and app-server are open source under Apache-2.0. App-server is the
documented interface for rich clients and can generate version-matched schemas.

## Decision

Use `codex app-server` over stdio JSONL as the first runtime. Place all Codex
protocol types and behavior behind an adapter. Keep experimental API disabled
for production features until a separate ADR accepts a specific dependency.

## Consequences

Positive:

- fastest path to a high-fidelity coding workflow;
- preserves Codex sandbox, approvals, auth, and session behavior;
- schema generation supports contract testing;
- Open Codex can focus on desktop, tasks, worktrees, and review.

Negative:

- runtime and protocol evolve outside this project;
- users initially install Codex separately;
- OpenAI-specific concepts require normalization;
- enterprise integrations may require client registration with OpenAI.

## Rejected alternatives

Reimplement the agent loop: too slow and security-sensitive for the first
release.

Fork the entire Codex repository: creates a costly long-lived merge burden and
does not solve product-layer architecture.

Use experimental WebSocket transport: upstream documents it as unsupported; it
is not an acceptable production dependency.

Use OpenCode first: attractive for multi-provider support, but lower fidelity
for the stated goal of reproducing Codex core workflows. It remains a future
adapter candidate.
