import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  PersistedEvent,
  ProjectRecord,
  SessionRecord,
  StateSnapshot,
  TaskDetail,
  TaskRecord,
  TaskStatus,
  WorkspaceRecord,
  WorkspaceState,
} from "@open-codex/protocol";

type Row = Record<string, unknown>;

export class OpenCodexStore {
  readonly path: string;
  #database: DatabaseSync;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  snapshot(): StateSnapshot {
    return {
      projects: this.listProjects(),
      tasks: this.listTasks(),
    };
  }

  upsertProject(project: ProjectRecord): ProjectRecord {
    this.#database
      .prepare(
        `INSERT INTO projects (
          id, name, path, repository_root, default_branch, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository_root) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          default_branch = excluded.default_branch,
          updated_at = excluded.updated_at`,
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.repositoryRoot,
        project.defaultBranch,
        project.createdAt,
        project.updatedAt,
      );
    return this.getProjectByRoot(project.repositoryRoot)!;
  }

  getProject(id: string): ProjectRecord | undefined {
    return mapProject(
      this.#database.prepare("SELECT * FROM projects WHERE id = ?").get(id),
    );
  }

  getProjectByRoot(repositoryRoot: string): ProjectRecord | undefined {
    return mapProject(
      this.#database
        .prepare("SELECT * FROM projects WHERE repository_root = ?")
        .get(repositoryRoot),
    );
  }

  listProjects(): ProjectRecord[] {
    return this.#database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all()
      .map(mapProject)
      .filter(isDefined);
  }

  createTask(task: TaskRecord): TaskRecord {
    this.#database
      .prepare(
        `INSERT INTO tasks (
          id, project_id, title, status, workspace_id, session_id, thread_id,
          last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.status,
        task.workspaceId ?? null,
        task.sessionId ?? null,
        task.threadId ?? null,
        task.lastError ?? null,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  updateTask(
    id: string,
    patch: Partial<
      Pick<
        TaskRecord,
        | "status"
        | "workspaceId"
        | "sessionId"
        | "threadId"
        | "lastError"
        | "title"
      >
    >,
  ): TaskRecord {
    const current = this.getTask(id);
    if (!current) {
      throw new Error(`Task not found: ${id}`);
    }
    const updated: TaskRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.#database
      .prepare(
        `UPDATE tasks SET
          title = ?, status = ?, workspace_id = ?, session_id = ?,
          thread_id = ?, last_error = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        updated.title,
        updated.status,
        updated.workspaceId ?? null,
        updated.sessionId ?? null,
        updated.threadId ?? null,
        updated.lastError ?? null,
        updated.updatedAt,
        id,
      );
    return updated;
  }

  getTask(id: string): TaskRecord | undefined {
    return mapTask(
      this.#database.prepare("SELECT * FROM tasks WHERE id = ?").get(id),
    );
  }

  getTaskByThreadId(threadId: string): TaskRecord | undefined {
    return mapTask(
      this.#database
        .prepare("SELECT * FROM tasks WHERE thread_id = ?")
        .get(threadId),
    );
  }

  listTasks(): TaskRecord[] {
    return this.#database
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
      .all()
      .map(mapTask)
      .filter(isDefined);
  }

  createWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    this.#database
      .prepare(
        `INSERT INTO workspaces (
          id, task_id, project_id, mode, path, base_ref, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        workspace.taskId,
        workspace.projectId,
        workspace.mode,
        workspace.path,
        workspace.baseRef,
        workspace.state,
        workspace.createdAt,
        workspace.updatedAt,
      );
    return workspace;
  }

  updateWorkspaceState(id: string, state: WorkspaceState): WorkspaceRecord {
    const current = this.getWorkspace(id);
    if (!current) {
      throw new Error(`Workspace not found: ${id}`);
    }
    const updated = { ...current, state, updatedAt: new Date().toISOString() };
    this.#database
      .prepare("UPDATE workspaces SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, updated.updatedAt, id);
    return updated;
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    return mapWorkspace(
      this.#database.prepare("SELECT * FROM workspaces WHERE id = ?").get(id),
    );
  }

  getWorkspaceForTask(taskId: string): WorkspaceRecord | undefined {
    return mapWorkspace(
      this.#database
        .prepare("SELECT * FROM workspaces WHERE task_id = ?")
        .get(taskId),
    );
  }

  createSession(session: SessionRecord): SessionRecord {
    this.#database
      .prepare(
        `INSERT INTO sessions (
          id, task_id, thread_id, runtime, runtime_version, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.taskId,
        session.threadId,
        session.runtime,
        session.runtimeVersion,
        session.state,
        session.createdAt,
        session.updatedAt,
      );
    return session;
  }

  getSession(id: string): SessionRecord | undefined {
    return mapSession(
      this.#database.prepare("SELECT * FROM sessions WHERE id = ?").get(id),
    );
  }

  getSessionForTask(taskId: string): SessionRecord | undefined {
    return mapSession(
      this.#database
        .prepare("SELECT * FROM sessions WHERE task_id = ?")
        .get(taskId),
    );
  }

  appendEvent(
    taskId: string,
    type: string,
    payload: unknown,
    occurredAt = new Date().toISOString(),
  ): PersistedEvent {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE task_id = ?",
        )
        .get(taskId) as Row;
      const sequence = Number(row.sequence) + 1;
      const event: PersistedEvent = {
        id: randomUUID(),
        taskId,
        sequence,
        type,
        payload,
        occurredAt,
      };
      this.#database
        .prepare(
          `INSERT INTO events (
            id, task_id, sequence, type, payload_json, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.taskId,
          event.sequence,
          event.type,
          JSON.stringify(event.payload),
          event.occurredAt,
        );
      this.#database.exec("COMMIT");
      return event;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listEvents(taskId: string): PersistedEvent[] {
    return this.#database
      .prepare("SELECT * FROM events WHERE task_id = ? ORDER BY sequence ASC")
      .all(taskId)
      .map(mapEvent);
  }

  getTaskDetail(taskId: string): TaskDetail | undefined {
    const task = this.getTask(taskId);
    if (!task) {
      return undefined;
    }
    const project = this.getProject(task.projectId);
    if (!project) {
      throw new Error(`Project not found for task: ${taskId}`);
    }
    return {
      task,
      project,
      workspace: task.workspaceId
        ? this.getWorkspace(task.workspaceId)
        : undefined,
      session: task.sessionId ? this.getSession(task.sessionId) : undefined,
      events: this.listEvents(taskId),
    };
  }

  #migrate(): void {
    const row = this.#database.prepare("PRAGMA user_version").get() as Row;
    const version = Number(row.user_version);
    if (version > 1) {
      throw new Error(`Unsupported database version: ${version}`);
    }
    if (version === 0) {
      this.#database.exec(`
        BEGIN;
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          repository_root TEXT NOT NULL UNIQUE,
          default_branch TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          workspace_id TEXT,
          session_id TEXT,
          thread_id TEXT UNIQUE,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          mode TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          base_ref TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL UNIQUE,
          runtime TEXT NOT NULL,
          runtime_version TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          UNIQUE(task_id, sequence)
        );
        CREATE INDEX events_task_sequence ON events(task_id, sequence);
        CREATE INDEX tasks_project_updated ON tasks(project_id, updated_at DESC);
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }
}

export function createProjectRecord(input: {
  name: string;
  path: string;
  repositoryRoot: string;
  defaultBranch: string;
}): ProjectRecord {
  const now = new Date().toISOString();
  return { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
}

export function createTaskRecord(projectId: string, title: string): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectId,
    title,
    status: "preparing",
    createdAt: now,
    updatedAt: now,
  };
}

function mapProject(row: unknown): ProjectRecord | undefined {
  if (!row) return undefined;
  const value = row as Row;
  return {
    id: String(value.id),
    name: String(value.name),
    path: String(value.path),
    repositoryRoot: String(value.repository_root),
    defaultBranch: String(value.default_branch),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function mapTask(row: unknown): TaskRecord | undefined {
  if (!row) return undefined;
  const value = row as Row;
  return {
    id: String(value.id),
    projectId: String(value.project_id),
    title: String(value.title),
    status: String(value.status) as TaskStatus,
    workspaceId: optionalString(value.workspace_id),
    sessionId: optionalString(value.session_id),
    threadId: optionalString(value.thread_id),
    lastError: optionalString(value.last_error),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function mapWorkspace(row: unknown): WorkspaceRecord | undefined {
  if (!row) return undefined;
  const value = row as Row;
  return {
    id: String(value.id),
    taskId: String(value.task_id),
    projectId: String(value.project_id),
    mode: String(value.mode) as WorkspaceRecord["mode"],
    path: String(value.path),
    baseRef: String(value.base_ref),
    state: String(value.state) as WorkspaceState,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function mapSession(row: unknown): SessionRecord | undefined {
  if (!row) return undefined;
  const value = row as Row;
  return {
    id: String(value.id),
    taskId: String(value.task_id),
    threadId: String(value.thread_id),
    runtime: "codex",
    runtimeVersion: String(value.runtime_version),
    state: String(value.state) as SessionRecord["state"],
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function mapEvent(row: unknown): PersistedEvent {
  const value = row as Row;
  return {
    id: String(value.id),
    taskId: String(value.task_id),
    sequence: Number(value.sequence),
    type: String(value.type),
    payload: JSON.parse(String(value.payload_json)) as unknown,
    occurredAt: String(value.occurred_at),
  };
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
