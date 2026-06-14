# Delivery Roadmap

## Planning assumptions

Team:

- one product/technical lead;
- one runtime/platform engineer;
- one desktop/frontend engineer;
- one additional full-stack or QA engineer;
- part-time product design.

The schedule excludes hosted infrastructure, enterprise administration, and a
custom model/runtime.

## Summary

| Milestone             |       Duration | Outcome                                           |
| --------------------- | -------------: | ------------------------------------------------- |
| Architecture baseline |         Week 0 | Spec, repository, protocol spike                  |
| Internal alpha        |        2 weeks | One real task through streaming and approval      |
| Single-user MVP       |  6 weeks total | Persistent task, worktree, diff, test, commit     |
| Public beta           | 12 weeks total | Cross-platform, packaged, recoverable, documented |
| Team/remote preview   |    +8-12 weeks | Authenticated remote daemon and team policy       |

One experienced full-time engineer should plan 20-28 weeks for public beta.

## Week 0: foundation

- Publish Spec, architecture, roadmap, reproduction guide, and ADR.
- Create monorepo and CI.
- Implement real app-server handshake.
- Generate version-matched schema.
- Normalize key streaming and approval events.
- Build a GUI vertical slice.

Exit: a contributor can run the smoke test and open the UI from a clean clone.

## Weeks 1-2: internal alpha

### Week 1

- Day 1: runtime discovery, version diagnostics, connection state.
- Day 2: account state and supported login flows.
- Day 3: thread start/read/resume/list.
- Day 4: turn lifecycle and item timeline.
- Day 5: command/file approval UX and contract fixtures.

### Week 2

- Day 6: project registration and SQLite migrations.
- Day 7: task/session/event persistence.
- Day 8: restart recovery and reconnect.
- Day 9: basic Git status and diff.
- Day 10: dogfood ten real tasks and fix P0 failures.

Exit:

- one repository can complete a task;
- approvals are reliable;
- restart preserves task and thread linkage;
- ten regression scenarios are automated or documented.

## Weeks 3-6: single-user MVP

### Week 3: workspaces

- managed worktree create/reconcile/cleanup;
- base revision and branch selection;
- dirty-worktree safeguards;
- setup command hooks.

### Week 4: review loop

- file tree and diff viewer;
- verification command presets;
- failure summaries;
- continue, interrupt, retry, and review.

### Week 5: delivery loop

- branch creation;
- explicit commit;
- push and draft pull request;
- artifacts and support bundle.

### Week 6: hardening

- crash and disk-pressure recovery;
- event replay and backpressure;
- security review;
- 50-task regression run;
- macOS internal package.

MVP exit:

- 40/50 tasks reach review;
- all task workspaces are isolated;
- restart and cleanup tests pass;
- no critical security findings.

## Weeks 7-12: public beta

### Weeks 7-8

- settings for model, reasoning, sandbox, approvals, and search;
- skills, MCP, plugins, and apps visibility;
- integrated PTY;
- search, archive, pin, and notifications.

### Weeks 9-10

- Windows process, sandbox, path, and installer work;
- Linux packaging and desktop integration;
- accessibility and keyboard navigation;
- updater, signatures, checksums, and SBOM.

### Weeks 11-12

- previous/current Codex compatibility matrix;
- migration and rollback drills;
- contributor beta;
- documentation and security audit;
- naming and trademark decision;
- release candidate and public beta.

Beta exit:

- 45/50 tasks reach review;
- supported platforms pass installation and recovery tests;
- protocol upgrade runbook has been exercised;
- release artifacts are signed where supported.

## Backlog after beta

1. OpenCode or ACP adapter.
2. Remote daemon with mutual authentication.
3. Cloud workspace provider.
4. Planner/implementer/reviewer orchestration.
5. Organization policy, audit export, and shared templates.
6. Optional encrypted sync and mobile review client.

## Weekly operating cadence

- Monday: protocol/upstream check and milestone planning.
- Daily: dogfood at least two real tasks.
- Wednesday: integration branch release.
- Thursday: regression and security review.
- Friday: demo, metrics, retrospective, and roadmap update.

No week adds more than one new runtime or execution environment.
