import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { GitService } from "@open-codex/git";
import type { JsonObject } from "@open-codex/protocol";
import { OpenCodexStore } from "@open-codex/storage";
import { afterEach, describe, expect, it } from "vitest";

import { OpenCodexController } from "../src/controller.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenCodexController", () => {
  it("persists an isolated task and resumes its Codex thread after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-codex-controller-"));
    cleanup.push(root);
    const repository = join(root, "repository");
    const databasePath = join(root, "state", "open-codex.db");
    const managedRoot = join(root, "worktrees");
    await createRepository(repository);

    const firstRuntime = new FakeRuntime();
    const firstStore = new OpenCodexStore(databasePath);
    const firstController = new OpenCodexController({
      store: firstStore,
      git: new GitService(managedRoot),
      codex: firstRuntime,
    });

    const project = (await firstController.execute({
      type: "project.add",
      requestId: "project",
      path: repository,
    })) as { id: string };
    const detail = (await firstController.execute({
      type: "task.create",
      requestId: "task",
      projectId: project.id,
      title: "Persist this task",
      workspaceMode: "managedWorktree",
    })) as {
      task: { id: string; status: string };
      workspace: { path: string };
      session: { threadId: string };
    };

    expect(detail.task.status).toBe("ready");
    expect(detail.workspace.path).not.toBe(repository);
    expect(firstRuntime.calls[0]).toMatchObject({
      method: "thread/start",
      params: {
        cwd: detail.workspace.path,
        sandbox: "workspace-write",
      },
    });

    await writeFile(join(detail.workspace.path, "README.md"), "changed\n");
    const diff = (await firstController.execute({
      type: "task.diff",
      requestId: "diff",
      taskId: detail.task.id,
    })) as { status: string; unstaged: string };
    expect(diff.status).toContain("M README.md");
    expect(diff.unstaged).toContain("+changed");

    await firstController.handleAgentEvent({
      type: "message.delta",
      threadId: detail.session.threadId,
      turnId: "turn-1",
      itemId: "message-1",
      text: "done",
    });
    await firstController.handleAgentEvent({
      type: "turn.completed",
      threadId: detail.session.threadId,
      turnId: "turn-1",
      status: "completed",
      raw: {},
    });
    firstStore.close();

    const secondRuntime = new FakeRuntime();
    const secondStore = new OpenCodexStore(databasePath);
    const secondController = new OpenCodexController({
      store: secondStore,
      git: new GitService(managedRoot),
      codex: secondRuntime,
    });

    const restored = (await secondController.execute({
      type: "task.open",
      requestId: "open",
      taskId: detail.task.id,
    })) as {
      task: { status: string };
      events: Array<{ type: string }>;
    };
    expect(restored.task.status).toBe("review");
    expect(restored.events.map((event) => event.type)).toEqual([
      "message.delta",
      "turn.completed",
    ]);

    await secondController.execute({
      type: "turn.start",
      requestId: "turn",
      taskId: detail.task.id,
      text: "Continue from the saved task",
    });
    expect(secondRuntime.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
    expect(secondRuntime.calls[0]?.params).toEqual({
      threadId: detail.session.threadId,
      cwd: detail.workspace.path,
    });
    expect(secondStore.getTaskDetail(detail.task.id)?.events.at(-1)?.type).toBe(
      "user.message",
    );
    secondStore.close();
  });
});

class FakeRuntime {
  running = false;
  version = "codex-cli test";
  calls: Array<{ method: string; params: JsonObject }> = [];

  async start(): Promise<void> {
    this.running = true;
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "thread/start") {
      return { thread: { id: "thread-persisted" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-restored" } };
    }
    if (method === "thread/resume") {
      return { thread: { id: "thread-persisted" } };
    }
    return {};
  }

  respond(): void {}
}

async function createRepository(repository: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main", repository]);
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: repository,
  });
  await execFileAsync("git", ["config", "user.name", "Open Codex Test"], {
    cwd: repository,
  });
  await writeFile(join(repository, "README.md"), "hello\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repository });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repository });
}
