# Open Codex Product and Technical Specification

Status: Draft v0.1

Date: 2026-06-14

Owner: Open Codex maintainers

## 1. Executive decision

Open Codex is a local-first desktop command center for AI-assisted software
development. It uses the Apache-2.0 licensed Codex CLI and `codex app-server` as
its primary agent runtime, then adds an independent open-source GUI and task
control plane.

The project will reproduce the core _workflow capability_ of a modern Codex
desktop experience through public, open interfaces. It will not copy private
source code, private APIs, branding, or pixel-level proprietary UI.

The first complete product loop is:

```text
project -> isolated task workspace -> agent turn -> approval -> test
        -> diff review -> continue or commit -> recover later
```

The recommended delivery target is:

- 2 weeks: internal alpha with one project and one active task;
- 6 weeks: reliable single-user MVP;
- 12 weeks: public beta on macOS, Windows, and Linux;
- 20-28 weeks for the same beta with one full-time engineer.

These estimates assume a 3-5 person team, reuse of Codex app-server, no custom
cloud sandbox, and no multi-tenant backend.

## 2. Problem

The open-source Codex CLI already performs planning, code edits, command
execution, approvals, and session persistence. A terminal interface is
efficient for one foreground task but does not fully address:

- several projects and tasks running in parallel;
- persistent visibility into commands, patches, tests, and failures;
- worktree creation and cleanup;
- reliable interruption and recovery;
- visual diff review and approval history;
- background execution and desktop notifications;
- a stable product model that can later support other agent runtimes.

Building another agent loop would duplicate the highest-risk subsystem and
create permanent compatibility work. The product opportunity is the control
plane around the existing runtime.

## 3. Goals

### 3.1 Product goals

1. Make one coding-agent task understandable at a glance.
2. Make concurrent tasks isolated by default.
3. Keep consequential actions visible and reviewable.
4. Recover safely after app, daemon, or runtime restart.
5. Preserve upstream Codex security semantics.
6. Keep the architecture open to additional adapters without reducing Codex
   fidelity.
7. Provide a reproducible development and release process.

### 3.2 Success metrics

For the public beta:

- 90% of a fixed 50-task regression suite reaches a reviewable terminal state;
- 99% of persisted task timelines survive a forced app restart;
- zero writes outside the selected workspace without the configured approval;
- zero cross-task worktree contamination in the regression suite;
- p95 UI event latency below 150 ms after the daemon receives an event;
- p95 cold start below 4 seconds excluding first-time authentication;
- every command, approval, patch, and test result has a task and turn identity;
- protocol compatibility is tested against the latest stable Codex release and
  one previous stable release.

### 3.3 Open-source goals

- Apache-2.0 project license.
- Public roadmap, ADRs, protocol fixtures, and regression scenarios.
- No committed credentials, transcripts, user repositories, or proprietary
  Codex assets.
- A documented path to build all project-owned code from source.

## 4. Non-goals

The first 12 weeks will not include:

- a new foundation model or model-serving platform;
- a reimplementation of the Codex agent loop;
- hosted multi-tenant accounts, billing, or RBAC;
- a custom remote sandbox;
- mobile clients;
- an agent marketplace;
- autonomous merging to protected branches;
- support for ten different coding agents;
- pixel-for-pixel reproduction of any OpenAI application;
- undocumented authentication flows or subscription sharing.

An OpenCode or ACP adapter may be explored only after the Codex vertical loop
meets the beta reliability bar.

## 5. Users and jobs

### 5.1 Primary user

An individual developer who works across one or more Git repositories and
wants to delegate bounded tasks while retaining control over execution and
changes.

Primary jobs:

- "Start a task without disturbing my current checkout."
- "See what the agent is doing and why it is blocked."
- "Approve a risky action with enough context."
- "Review the final patch and tests before I keep it."
- "Close the app and continue later."

### 5.2 Secondary user

A small engineering team that wants repeatable agent workflows, policy,
auditing, and pull-request handoff. Team features are post-beta, but the event
and ownership models must not prevent them.

## 6. Product principles

1. Local first. Source code and transcripts remain local unless the selected
   runtime or user action sends them elsewhere.
2. Human-legible execution. Commands, writes, network access, and approvals are
   first-class UI objects.
3. Runtime fidelity. Do not flatten Codex features that users depend on.
4. Stable internal model. Raw upstream protocol stays behind an adapter.
5. Fail closed. Unknown approval requests are not auto-approved.
6. Recover from facts. Rebuild view state from persisted events and runtime
   snapshots, not fragile UI state.
7. One task, one workspace. Parallel write-capable tasks never share a
   checkout by default.

## 7. Capability scope

### 7.1 P0: single-user MVP

| Capability        | Required behavior                                               | Source         |
| ----------------- | --------------------------------------------------------------- | -------------- |
| Runtime discovery | Find configured `codex` binary and display version              | CLI            |
| Connection        | Launch app-server on stdio and complete handshake               | app-server     |
| Authentication    | Read auth state and initiate supported login flow               | app-server     |
| Projects          | Add, validate, open, and remove local Git repositories          | Open Codex     |
| Tasks             | Create task with title, prompt, acceptance criteria, and status | Open Codex     |
| Workspaces        | Local checkout or isolated Git worktree                         | Open Codex     |
| Threads           | Start, list, read, resume, fork, archive                        | app-server     |
| Turns             | Start, steer, interrupt, and show completion                    | app-server     |
| Timeline          | Stream message, command, file, tool, warning, and error items   | both           |
| Approvals         | Command and file-change allow/deny/session decisions            | app-server     |
| Diff              | Show working-tree diff grouped by file                          | Git/Open Codex |
| Tests             | Run user-selected verification commands and retain output       | both           |
| Commit            | Create branch and commit after explicit user action             | Git/Open Codex |
| Recovery          | Restore projects, tasks, events, workspace, and thread link     | both           |
| Diagnostics       | Export redacted local support bundle                            | Open Codex     |

### 7.2 P1: public beta

- visual branch and worktree management;
- handoff between managed worktree and local checkout;
- model, reasoning, sandbox, approval, and web-search settings;
- rich terminal with PTY resize and stdin;
- Codex review workflow;
- MCP server, skill, plugin, and app visibility;
- task search, pinning, archive, and notifications;
- one-click push and draft pull request;
- signed installers and auto-update;
- Windows and Linux support;
- accessibility and keyboard navigation.

### 7.3 P2: post-beta

- remote daemon with authenticated encrypted transport;
- cloud sandbox adapter;
- team policy and audit export;
- planner, implementer, reviewer, and fixer orchestration;
- OpenCode or ACP adapters;
- shared templates and workflows;
- optional encrypted sync.

## 8. Core user flows

### 8.1 First run

1. App verifies the daemon and Codex binary.
2. App reads Codex account state.
3. If required, user chooses browser or device-code login.
4. User selects a local Git repository.
5. App records only repository metadata, not file content.
6. User sees the default security profile before the first task.

Acceptance:

- no model turn is sent before authentication is complete;
- the selected binary path and exact version are visible;
- a non-Git directory is clearly identified and cannot use worktree mode.

### 8.2 Create isolated task

1. User enters title, prompt, acceptance criteria, and base branch.
2. Default workspace mode is managed worktree.
3. Worktree manager validates repository state and disk capacity.
4. It creates a detached worktree under the Open Codex data directory.
5. Task and workspace records are committed in one database transaction.
6. Adapter starts a Codex thread with the worktree as `cwd`.
7. Prompt becomes the first turn only after thread creation succeeds.

Acceptance:

- failure leaves no orphan task marked as running;
- cleanup of a partial worktree is idempotent;
- uncommitted changes in the base checkout are never silently copied.

### 8.3 Approval

1. Runtime sends a server-initiated JSON-RPC request.
2. Adapter persists the request before notifying the UI.
3. UI shows command/diff, cwd, reason, network target, and persistence scope.
4. User chooses allow once, allow for session, decline, or cancel when offered.
5. Daemon sends exactly one response for the request id.
6. Resolution and resulting item completion are persisted separately.

Acceptance:

- closing all UI windows does not imply approval;
- unknown request methods remain pending and display a safe generic view;
- duplicate clicks cannot send duplicate responses;
- unresolved approvals are surfaced immediately after reconnect.

### 8.4 Review and commit

1. Task reaches completed, interrupted, or failed state.
2. Git service computes status and a binary-safe diff summary.
3. UI shows changed files, hunks, verification results, and unresolved risks.
4. User can continue the same thread, discard the worktree, or create a branch.
5. Commit requires an explicit message and confirmation.
6. Push and pull request are separate explicit actions.

Acceptance:

- Open Codex never commits secrets automatically;
- ignored and untracked files have explicit treatment;
- destructive cleanup shows whether uncommitted work will be deleted.

## 9. System architecture

### 9.1 Components

1. Desktop shell: Tauri 2 lifecycle, windows, menus, notifications, updater.
2. Web UI: React/TypeScript task, timeline, diff, terminal, and settings views.
3. Local daemon: single owner of runtimes, tasks, database, Git, and policies.
4. Codex adapter: typed JSON-RPC client and normalization layer.
5. Event store: SQLite in WAL mode with append-only task events.
6. Git service: repository validation, worktree lifecycle, diff, branch, commit.
7. Policy service: local product constraints layered around runtime policy.
8. Release tooling: schema compatibility, installers, signatures, SBOM.

### 9.2 Process boundary

The desktop webview never launches Codex or Git directly. It calls the daemon
over a loopback-only authenticated channel. During development this is a
WebSocket on `127.0.0.1`; production will use a Tauri-managed child process and
an ephemeral capability token or platform IPC.

The daemon launches one app-server process per user profile, not one per window.
Threads remain the unit of Codex conversation. Tasks remain the Open Codex unit
of planning, workspace ownership, and delivery.

### 9.3 Upstream protocol rules

- Production transport: stdio JSONL.
- Required handshake: `initialize`, then `initialized`.
- Stable API only by default.
- Generated schema is tied to the detected Codex version.
- Raw messages are never exposed as the public UI contract.
- Unknown notifications are retained as raw observable events.
- Unknown server requests fail closed and require a user decision.
- WebSocket app-server transport is not a production dependency.

### 9.4 Internal event envelope

```ts
type EventEnvelope = {
  id: string;
  sequence: number;
  occurredAt: string;
  projectId: string;
  taskId: string;
  workspaceId?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  source: "user" | "daemon" | "codex" | "git";
  type: string;
  payload: unknown;
  schemaVersion: number;
};
```

Events are append-only. Mutable tables are projections for efficient reads.
Sensitive values are redacted before persistence when they match credential
patterns or are marked secret by the source.

## 10. Data model

### 10.1 Entities

Project:

- id, display name, canonical path, repository identity, default branch;
- created/updated timestamps and archived flag.

Task:

- id, project id, title, prompt, acceptance criteria;
- status, priority, owner, created/updated timestamps;
- active workspace/session ids and terminal outcome.

Workspace:

- id, task id, mode (`local`, `managed_worktree`, future `remote`);
- path, base revision, branch, state, snapshot reference;
- created, last used, and cleanup timestamps.

Session:

- id, task id, adapter kind, upstream thread id;
- runtime binary/version, protocol fingerprint, selected settings;
- state and last event cursor.

Turn:

- id, session id, upstream turn id, status;
- started/completed timestamps, usage summary, failure category.

Artifact:

- id, task/turn id, kind (`diff`, `test`, `log`, `screenshot`, `commit`, `pr`);
- URI or local path, content hash, metadata.

Approval:

- id, task/turn/item id, upstream request id, method;
- request detail, offered decisions, decision, actor, timestamps.

Event:

- immutable envelope described above.

### 10.2 SQLite requirements

- WAL journal mode and foreign keys enabled.
- Numbered forward-only migrations.
- Transactional task/workspace/session creation.
- Unique constraint on upstream request id per runtime connection.
- Event sequence monotonically increases per task.
- Retention policy is user-configurable; deletion is explicit.
- Database backup occurs before destructive migration.

## 11. State machines

Task:

```text
draft -> preparing -> ready -> running -> waiting_for_user
      -> running -> verifying -> review -> completed
      -> failed | interrupted | abandoned
```

Workspace:

```text
creating -> ready -> dirty -> snapshotting -> archived -> deleting -> deleted
                    \-> corrupt
```

Approval:

```text
pending -> accepted_once | accepted_session | declined | cancelled | expired
```

Invalid transitions return a domain error and create a diagnostic event.

## 12. Security specification

### 12.1 Default profile

- app-server uses stdio;
- daemon binds only to loopback;
- workspace-write sandbox;
- network disabled unless the user enables it;
- on-request approval policy;
- `.git`, `.codex`, and other runtime-protected paths remain protected;
- no automatic persistent approval;
- no automatic commit, push, or pull request;
- analytics off unless explicitly opted in.

### 12.2 Trust boundaries

Untrusted:

- prompts and model output;
- repository files and instructions;
- command output and generated patches;
- web content;
- MCP, app, and plugin content;
- imported task templates.

Trusted only after validation:

- runtime binary selected by the user;
- daemon/UI messages authenticated by local capability;
- database migrations shipped by a signed release;
- update manifests and binaries.

### 12.3 Secrets

- Never write API keys into project files or logs.
- Delegate Codex token storage and refresh to supported Codex auth flows.
- Store Open Codex secrets in the OS credential store.
- Redact common token, key, cookie, and authorization-header patterns.
- Support user-defined redaction patterns.
- Support bundle export is previewed before writing.

### 12.4 Remote access

Remote access is out of scope for MVP. A future remote daemon requires mutual
authentication, encryption, origin checks, short-lived capabilities, request
rate limits, audit logs, and explicit network exposure. It must not rely on the
experimental unauthenticated app-server WebSocket mode.

## 13. Git and worktree specification

- Managed worktrees live under the Open Codex application data directory.
- Default starting point is the selected branch's committed `HEAD`.
- Worktree begins detached; a branch is created only on user request.
- One write-capable task owns one worktree.
- The same branch cannot be checked out in multiple worktrees.
- Cleanup never runs while a turn, approval, terminal, or Git operation is
  active.
- Before deletion, dirty worktrees receive a snapshot or explicit discard
  confirmation.
- Startup reconciliation compares database records with `git worktree list
--porcelain`.
- Pruning is conservative and never deletes paths not created by Open Codex.

## 14. UI information architecture

Primary navigation:

- Projects
- Tasks
- Search
- Settings
- Diagnostics

Task screen:

- header: project, workspace, branch, runtime status;
- timeline: user messages, agent messages, commands, file changes, tools,
  approvals, warnings, tests;
- right inspector: current diff, files, task acceptance criteria;
- composer: prompt, attachments, model and security profile;
- actions: interrupt, continue, review, branch, commit, archive.

The UI uses progressive disclosure. Raw JSON is available in diagnostics, not
as the default experience.

Accessibility requirements:

- all actions keyboard reachable;
- visible focus states;
- semantic status text in addition to color;
- screen-reader labels for streamed status and approval actions;
- reduced-motion support;
- contrast meets WCAG AA.

## 15. Observability

Local logs are structured JSON with:

- timestamp, level, component, task/session/turn identifiers;
- operation name, duration, result category;
- runtime version and protocol fingerprint;
- no prompt or source content by default.

Metrics are local by default:

- startup and connection duration;
- turn count and terminal status;
- approval count and latency;
- event lag and dropped-message count;
- worktree creation/cleanup duration;
- database migration and recovery outcome.

Optional telemetry must be opt-in, documented, aggregated, and content-free.

## 16. Testing strategy

### 16.1 Unit

- protocol parsing and normalization;
- state transitions;
- path canonicalization;
- redaction;
- event projections;
- worktree command construction.

### 16.2 Contract

- recorded app-server request/response fixtures;
- generated schema compilation;
- stable notification normalization;
- approval request and response shapes;
- unknown event behavior;
- latest and previous stable Codex versions.

### 16.3 Integration

- launch real app-server and handshake;
- account/read without starting a model turn;
- temporary Git repository and worktree lifecycle;
- daemon restart with pending and completed tasks;
- forced process termination and recovery.

### 16.4 End-to-end

Fixed tasks include:

- explain a repository without edits;
- edit one file and run one test;
- request denied network access;
- command approval accepted once;
- command approval declined;
- interrupted turn and resume;
- dirty worktree recovery;
- binary and large-file diff handling;
- failed tests and continuation;
- branch and commit.

No CI test should consume paid model tokens unless it is in a separately
authorized nightly environment.

## 17. Distribution

Beta artifacts:

- macOS arm64 and x64;
- Windows x64;
- Linux x64 AppImage or deb.

Each release includes:

- signed application artifact where platform support exists;
- checksums;
- SBOM;
- third-party notices;
- changelog and migration notes;
- supported Codex version range;
- rollback instructions.

The first release may require a separately installed Codex CLI. Bundling Codex
is a later decision requiring release-size, update, attribution, and platform
signing analysis.

## 18. Legal and naming

Codex CLI is Apache-2.0. Open Codex should keep its own Apache-2.0 license and
preserve any upstream notices if upstream code is later copied or modified.

The product must state that it is unofficial and not affiliated with OpenAI.
The working name "Open Codex" creates trademark and user-confusion risk. Before
public marketing, obtain legal review or adopt a more distinctive project name.

Do not use OpenAI logos, proprietary application assets, or private endpoints.

## 19. Exit criteria

### Internal alpha

- real app-server handshake;
- one repository and one thread;
- streaming agent output;
- command/file items and approvals;
- app restart does not lose the thread identifier;
- known limitations documented.

### MVP

- project/task/workspace/session persistence;
- managed worktree lifecycle;
- diff review, tests, branch, and commit;
- auth UI and settings;
- 40/50 regression tasks reach review;
- no critical security findings.

### Public beta

- all P1 capabilities;
- three desktop platforms;
- 45/50 regression tasks reach review;
- upgrade and rollback tested;
- contributor and security processes active;
- naming/trademark decision complete.

## 20. Open questions

1. Should v1 require a system Codex installation or bundle a pinned binary?
2. Should the daemon be TypeScript through beta or move process/Git ownership to
   Rust before packaging?
3. What is the minimum supported Codex version after protocol fixtures exist?
4. Should transcripts be encrypted at rest by default?
5. How should dirty local changes be handed into a worktree without surprising
   the user?
6. Which project name avoids trademark confusion while retaining discoverability?

These questions do not block the alpha. Decisions 1-3 must be closed before the
public beta.

## 21. Authoritative references

- [Codex open-source repository](https://github.com/openai/codex)
- [Codex app-server documentation](https://developers.openai.com/codex/app-server)
- [Codex app-server source README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex open-source components](https://developers.openai.com/codex/open-source)
- [Codex approvals and security](https://developers.openai.com/codex/agent-approvals-security)
- [Codex worktrees](https://developers.openai.com/codex/app/worktrees)
- [Git worktree documentation](https://git-scm.com/docs/git-worktree)
