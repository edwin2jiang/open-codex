import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type { CodexAppServerClient } from "@open-codex/codex-client";
import { GitService } from "@open-codex/git";
import type {
  AgentEvent,
  ApprovalDecision,
  ClientCommand,
  OpenCodexEvent,
  ProjectRecord,
  TaskDetail,
  TaskStatus,
} from "@open-codex/protocol";
import {
  createProjectRecord,
  createTaskRecord,
  OpenCodexStore,
} from "@open-codex/storage";

type Runtime = Pick<
  CodexAppServerClient,
  "request" | "respond" | "running" | "start" | "version"
>;

type ThreadResponse = {
  thread?: {
    id?: string;
  };
};

type TurnResponse = {
  turn?: {
    id?: string;
  };
};

export class OpenCodexController extends EventEmitter {
  readonly store: OpenCodexStore;
  readonly git: GitService;
  readonly codex: Runtime;

  #loadedThreads = new Set<string>();
  #approvalTasks = new Map<number | string, string>();

  constructor(input: {
    store: OpenCodexStore;
    git: GitService;
    codex: Runtime;
  }) {
    super();
    this.store = input.store;
    this.git = input.git;
    this.codex = input.codex;
  }

  async execute(command: ClientCommand): Promise<unknown> {
    switch (command.type) {
      case "state.get":
        return this.store.snapshot();
      case "project.add":
        return this.addProject(command.path);
      case "task.create":
        return this.createTask(command);
      case "task.open":
        return this.requireTask(command.taskId);
      case "task.diff":
        return this.getDiff(command.taskId);
      case "turn.start":
        return this.startTurn(command.taskId, command.text);
      case "turn.interrupt":
        return this.interruptTurn(command.taskId, command.turnId);
      case "approval.resolve":
        return this.resolveApproval(command.serverRequestId, command.decision);
    }
  }

  async handleAgentEvent(event: AgentEvent): Promise<void> {
    if (!("threadId" in event) || !event.threadId) {
      this.emitEvent(event);
      return;
    }

    const task = this.store.getTaskByThreadId(event.threadId);
    if (!task) {
      this.emitEvent(event);
      return;
    }

    this.store.appendEvent(task.id, event.type, event);

    const status = statusForEvent(event);
    if (status) {
      this.store.updateTask(task.id, { status });
      this.emitStateChanged();
    }

    if (event.type === "approval.requested") {
      this.#approvalTasks.set(event.requestId, task.id);
    }

    this.emitEvent(event);
  }

  private async addProject(path: string): Promise<ProjectRecord> {
    const repository = await this.git.inspectRepository(path);
    const project = createProjectRecord({
      name: repository.name,
      path: repository.inputPath,
      repositoryRoot: repository.repositoryRoot,
      defaultBranch: repository.defaultBranch,
    });
    const saved = this.store.upsertProject(project);
    this.emitStateChanged();
    return saved;
  }

  private async createTask(
    command: Extract<ClientCommand, { type: "task.create" }>,
  ): Promise<TaskDetail> {
    const project = this.store.getProject(command.projectId);
    if (!project) {
      throw new Error(`Project not found: ${command.projectId}`);
    }

    const task = createTaskRecord(project.id, command.title.trim());
    this.store.createTask(task);
    this.emitStateChanged();

    const mode = command.workspaceMode ?? "managedWorktree";
    const baseRef = command.baseRef ?? "HEAD";
    let workspacePath = project.repositoryRoot;
    let createdManagedWorktree = false;

    try {
      if (mode === "managedWorktree") {
        const worktree = await this.git.createManagedWorktree({
          repositoryRoot: project.repositoryRoot,
          taskId: task.id,
          baseRef,
        });
        workspacePath = worktree.path;
        createdManagedWorktree = true;
      }

      const now = new Date().toISOString();
      const workspaceId = randomUUID();
      this.store.createWorkspace({
        id: workspaceId,
        taskId: task.id,
        projectId: project.id,
        mode,
        path: workspacePath,
        baseRef,
        state: "ready",
        createdAt: now,
        updatedAt: now,
      });
      this.store.updateTask(task.id, { workspaceId });

      await this.codex.start();
      const response = (await this.codex.request("thread/start", {
        cwd: workspacePath,
        model: command.model,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      })) as ThreadResponse;
      const threadId = response.thread?.id;
      if (!threadId) {
        throw new Error("Codex did not return a thread id");
      }

      const sessionId = randomUUID();
      const sessionTime = new Date().toISOString();
      this.store.createSession({
        id: sessionId,
        taskId: task.id,
        threadId,
        runtime: "codex",
        runtimeVersion: this.codex.version,
        state: "active",
        createdAt: sessionTime,
        updatedAt: sessionTime,
      });
      this.store.updateTask(task.id, {
        sessionId,
        threadId,
        status: "ready",
      });
      this.#loadedThreads.add(threadId);
      this.emitStateChanged();
      return this.requireTask(task.id);
    } catch (error) {
      this.store.updateTask(task.id, {
        status: "failed",
        lastError: errorMessage(error),
      });
      if (createdManagedWorktree) {
        await this.git
          .removeManagedWorktree(project.repositoryRoot, workspacePath)
          .catch(() => undefined);
        const workspace = this.store.getWorkspaceForTask(task.id);
        if (workspace) {
          this.store.updateWorkspaceState(workspace.id, "archived");
        }
      }
      this.emitStateChanged();
      throw error;
    }
  }

  private async startTurn(taskId: string, text: string): Promise<TurnResponse> {
    const detail = this.requireTask(taskId);
    if (!detail.session || !detail.workspace) {
      throw new Error(`Task is not ready: ${taskId}`);
    }

    await this.codex.start();
    await this.ensureThreadLoaded(
      detail.session.threadId,
      detail.workspace.path,
    );

    this.store.appendEvent(taskId, "user.message", {
      type: "user.message",
      threadId: detail.session.threadId,
      text,
    });
    this.store.updateTask(taskId, { status: "running", lastError: undefined });
    this.emitStateChanged();

    return (await this.codex.request("turn/start", {
      threadId: detail.session.threadId,
      input: [{ type: "text", text }],
      cwd: detail.workspace.path,
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [detail.workspace.path],
        networkAccess: false,
      },
    })) as TurnResponse;
  }

  private async interruptTurn(
    taskId: string,
    turnId: string,
  ): Promise<unknown> {
    const detail = this.requireTask(taskId);
    if (!detail.session) {
      throw new Error(`Task has no Codex session: ${taskId}`);
    }
    const result = await this.codex.request("turn/interrupt", {
      threadId: detail.session.threadId,
      turnId,
    });
    this.store.updateTask(taskId, { status: "interrupted" });
    this.emitStateChanged();
    return result;
  }

  private resolveApproval(
    requestId: number | string,
    decision: ApprovalDecision,
  ): { resolved: true } {
    this.codex.respond(requestId, { decision });
    const taskId = this.#approvalTasks.get(requestId);
    if (taskId) {
      this.store.updateTask(taskId, {
        status:
          decision === "accept" || decision === "acceptForSession"
            ? "running"
            : "review",
      });
      this.#approvalTasks.delete(requestId);
      this.emitStateChanged();
    }
    return { resolved: true };
  }

  private async getDiff(taskId: string): Promise<unknown> {
    const detail = this.requireTask(taskId);
    if (!detail.workspace) {
      throw new Error(`Task has no workspace: ${taskId}`);
    }
    return this.git.diff(detail.workspace.path);
  }

  private requireTask(taskId: string): TaskDetail {
    const detail = this.store.getTaskDetail(taskId);
    if (!detail) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return detail;
  }

  private async ensureThreadLoaded(
    threadId: string,
    cwd: string,
  ): Promise<void> {
    if (this.#loadedThreads.has(threadId)) {
      return;
    }
    await this.codex.request("thread/resume", { threadId, cwd });
    this.#loadedThreads.add(threadId);
  }

  private emitStateChanged(): void {
    this.emitEvent({
      type: "state.changed",
      snapshot: this.store.snapshot(),
    });
  }

  private emitEvent(event: OpenCodexEvent): void {
    this.emit("event", event);
  }
}

function statusForEvent(event: AgentEvent): TaskStatus | undefined {
  switch (event.type) {
    case "turn.started":
      return "running";
    case "approval.requested":
      return "waitingForUser";
    case "approval.resolved":
      return "running";
    case "turn.completed":
      if (event.status === "interrupted") return "interrupted";
      if (event.status === "failed") return "failed";
      return "review";
    default:
      return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
