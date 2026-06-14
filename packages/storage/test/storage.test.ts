import { describe, expect, it } from "vitest";

import {
  createProjectRecord,
  createTaskRecord,
  OpenCodexStore,
} from "../src/index.js";

describe("OpenCodexStore", () => {
  it("persists projects, tasks, workspaces, sessions, and ordered events", () => {
    const store = new OpenCodexStore(":memory:");
    const project = store.upsertProject(
      createProjectRecord({
        name: "demo",
        path: "/tmp/demo",
        repositoryRoot: "/tmp/demo",
        defaultBranch: "main",
      }),
    );
    const task = store.createTask(
      createTaskRecord(project.id, "Add a feature"),
    );
    const now = new Date().toISOString();
    const workspace = store.createWorkspace({
      id: "workspace-1",
      taskId: task.id,
      projectId: project.id,
      mode: "managedWorktree",
      path: "/tmp/worktrees/task-1",
      baseRef: "HEAD",
      state: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const session = store.createSession({
      id: "session-1",
      taskId: task.id,
      threadId: "thread-1",
      runtime: "codex",
      runtimeVersion: "codex-cli test",
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    store.updateTask(task.id, {
      status: "ready",
      workspaceId: workspace.id,
      sessionId: session.id,
      threadId: session.threadId,
    });
    store.appendEvent(task.id, "message.delta", { text: "one" });
    store.appendEvent(task.id, "message.delta", { text: "two" });

    const detail = store.getTaskDetail(task.id);
    expect(detail?.project.id).toBe(project.id);
    expect(detail?.workspace?.path).toBe("/tmp/worktrees/task-1");
    expect(detail?.session?.threadId).toBe("thread-1");
    expect(detail?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(store.snapshot().tasks[0]?.status).toBe("ready");
    store.close();
  });

  it("upserts projects by canonical repository root", () => {
    const store = new OpenCodexStore(":memory:");
    const first = store.upsertProject(
      createProjectRecord({
        name: "demo",
        path: "/tmp/demo",
        repositoryRoot: "/tmp/demo",
        defaultBranch: "main",
      }),
    );
    const second = store.upsertProject(
      createProjectRecord({
        name: "renamed",
        path: "/tmp/demo",
        repositoryRoot: "/tmp/demo",
        defaultBranch: "trunk",
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("renamed");
    expect(store.listProjects()).toHaveLength(1);
    store.close();
  });
});
