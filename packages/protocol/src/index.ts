export type JsonObject = Record<string, unknown>;

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type TaskStatus =
  | "preparing"
  | "ready"
  | "running"
  | "waitingForUser"
  | "review"
  | "completed"
  | "failed"
  | "interrupted"
  | "archived";

export type WorkspaceState = "creating" | "ready" | "dirty" | "archived";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  repositoryRoot: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskRecord = {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  workspaceId?: string;
  sessionId?: string;
  threadId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRecord = {
  id: string;
  taskId: string;
  projectId: string;
  mode: "local" | "managedWorktree";
  path: string;
  baseRef: string;
  state: WorkspaceState;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  id: string;
  taskId: string;
  threadId: string;
  runtime: "codex";
  runtimeVersion: string;
  state: "active" | "disconnected" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type PersistedEvent = {
  id: string;
  taskId: string;
  sequence: number;
  type: string;
  payload: unknown;
  occurredAt: string;
};

export type TaskDetail = {
  task: TaskRecord;
  project: ProjectRecord;
  workspace?: WorkspaceRecord;
  session?: SessionRecord;
  events: PersistedEvent[];
};

export type StateSnapshot = {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
};

export type DiffSnapshot = {
  status: string;
  unstaged: string;
  staged: string;
};

export type AgentEvent =
  | {
      type: "runtime.ready";
      runtime: "codex";
      version: string;
    }
  | {
      type: "thread.started";
      threadId: string;
      raw: JsonObject;
    }
  | {
      type: "turn.started";
      threadId: string;
      turnId: string;
      raw: JsonObject;
    }
  | {
      type: "message.delta";
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "item.started" | "item.completed";
      threadId: string;
      turnId: string;
      item: JsonObject;
    }
  | {
      type: "approval.requested";
      requestId: string | number;
      method: string;
      threadId?: string;
      turnId?: string;
      itemId?: string;
      detail: JsonObject;
    }
  | {
      type: "approval.resolved";
      requestId: string | number;
      threadId?: string;
    }
  | {
      type: "turn.completed";
      threadId: string;
      turnId: string;
      status: string;
      raw: JsonObject;
    }
  | {
      type: "runtime.error";
      message: string;
      raw?: JsonObject;
    }
  | {
      type: "raw.notification";
      method: string;
      params: JsonObject;
    };

export type ClientCommand =
  | {
      type: "state.get";
      requestId: string;
    }
  | {
      type: "project.add";
      requestId: string;
      path: string;
    }
  | {
      type: "task.create";
      requestId: string;
      projectId: string;
      title: string;
      baseRef?: string;
      workspaceMode?: "local" | "managedWorktree";
      model?: string;
    }
  | {
      type: "task.open";
      requestId: string;
      taskId: string;
    }
  | {
      type: "task.diff";
      requestId: string;
      taskId: string;
    }
  | {
      type: "turn.start";
      requestId: string;
      taskId: string;
      text: string;
    }
  | {
      type: "turn.interrupt";
      requestId: string;
      taskId: string;
      turnId: string;
    }
  | {
      type: "approval.resolve";
      requestId: string;
      serverRequestId: string | number;
      decision: ApprovalDecision;
    };

export type OpenCodexEvent =
  | AgentEvent
  | {
      type: "state.changed";
      snapshot: StateSnapshot;
    };

export type ServerMessage =
  | {
      type: "event";
      event: OpenCodexEvent;
    }
  | {
      type: "response";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      requestId: string;
      ok: false;
      error: string;
    };

export function isClientCommand(value: unknown): value is ClientCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientCommand>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.requestId === "string"
  );
}
