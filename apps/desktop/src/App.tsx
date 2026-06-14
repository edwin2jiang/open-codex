import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentEvent,
  ApprovalDecision,
  ClientCommand,
  DiffSnapshot,
  OpenCodexEvent,
  PersistedEvent,
  ProjectRecord,
  ServerMessage,
  StateSnapshot,
  TaskDetail,
  TaskRecord,
} from "@open-codex/protocol";

type TimelineEntry = {
  id: string;
  tone: "agent" | "command" | "file" | "system" | "error";
  label: string;
  body: string;
};

const daemonUrl =
  import.meta.env.VITE_OPEN_CODEX_DAEMON_URL ?? "ws://127.0.0.1:4737/events";

const emptySnapshot: StateSnapshot = { projects: [], tasks: [] };

export function App() {
  const [connected, setConnected] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState("connecting");
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskDetail, setTaskDetail] = useState<TaskDetail>();
  const [projectPath, setProjectPath] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<
    "local" | "managedWorktree"
  >("managedWorktree");
  const [prompt, setPrompt] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [diff, setDiff] = useState<DiffSnapshot>();
  const [busy, setBusy] = useState<string>();
  const [approval, setApproval] = useState<
    Extract<AgentEvent, { type: "approval.requested" }> | undefined
  >();
  const socketRef = useRef<WebSocket | null>(null);
  const selectedTaskRef = useRef<TaskDetail | undefined>(undefined);
  const pendingRef = useRef(
    new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >(),
  );

  selectedTaskRef.current = taskDetail;

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(daemonUrl);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) return;
        setConnected(true);
        setRuntimeVersion("connected");
        void requestState();
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        setConnected(false);
        setRuntimeVersion("reconnecting");
        rejectPending("Daemon disconnected");
        reconnectTimer = window.setTimeout(connect, 1_000);
      });
      socket.addEventListener("message", (message) => {
        const payload = JSON.parse(message.data as string) as ServerMessage;
        if (payload.type === "response") {
          const pending = pendingRef.current.get(payload.requestId);
          if (!pending) return;
          pendingRef.current.delete(payload.requestId);
          payload.ok
            ? pending.resolve(payload.result)
            : pending.reject(new Error(payload.error));
          return;
        }
        consumeEvent(payload.event);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      rejectPending("Desktop client closed");
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId && snapshot.projects[0]) {
      setSelectedProjectId(snapshot.projects[0].id);
    }
  }, [selectedProjectId, snapshot.projects]);

  useEffect(() => {
    if (
      selectedTaskId &&
      !snapshot.tasks.some((task) => task.id === selectedTaskId)
    ) {
      setSelectedTaskId("");
      setTaskDetail(undefined);
    }
  }, [selectedTaskId, snapshot.tasks]);

  useEffect(() => {
    if (!connected || !selectedTaskId) return;
    void openTask(selectedTaskId);
  }, [connected, selectedTaskId]);

  const projects = snapshot.projects;
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const tasks = useMemo(
    () => snapshot.tasks.filter((task) => task.projectId === selectedProjectId),
    [selectedProjectId, snapshot.tasks],
  );
  const canSend =
    connected &&
    Boolean(taskDetail?.session) &&
    Boolean(prompt.trim()) &&
    !busy;

  async function requestState() {
    try {
      const state = (await send({
        type: "state.get",
        requestId: crypto.randomUUID(),
      })) as StateSnapshot;
      setSnapshot(state);
    } catch (error) {
      addEntry("error", "Could not load state", errorMessage(error));
    }
  }

  function consumeEvent(event: OpenCodexEvent) {
    if (event.type === "state.changed") {
      setSnapshot(event.snapshot);
      setTaskDetail((current) => {
        if (!current) return current;
        const task = event.snapshot.tasks.find(
          (candidate) => candidate.id === current.task.id,
        );
        return task ? { ...current, task } : current;
      });
      return;
    }
    if (event.type === "runtime.ready") {
      setRuntimeVersion(event.version);
      return;
    }
    const activeThread = selectedTaskRef.current?.session?.threadId;
    if (
      "threadId" in event &&
      event.threadId &&
      event.threadId !== activeThread
    ) {
      return;
    }
    consumeAgentEvent(event);
  }

  function consumeAgentEvent(event: AgentEvent) {
    if (event.type === "message.delta") {
      setTimeline((entries) => appendMessageDelta(entries, event));
      return;
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      const entry = itemEntry(event);
      if (entry) {
        setTimeline((entries) => upsertEntry(entries, entry));
      }
      return;
    }
    if (event.type === "approval.requested") {
      setApproval(event);
      return;
    }
    if (event.type === "approval.resolved") {
      setApproval(undefined);
      return;
    }
    if (event.type === "turn.completed") {
      addEntry("system", "Turn completed", event.status);
      void refreshDiff();
      return;
    }
    if (event.type === "runtime.error") {
      addEntry("error", "Runtime error", event.message);
    }
  }

  async function addProject() {
    const path = projectPath.trim();
    if (!path) return;
    setBusy("project");
    try {
      const project = (await send({
        type: "project.add",
        requestId: crypto.randomUUID(),
        path,
      })) as ProjectRecord;
      setSelectedProjectId(project.id);
      setProjectPath("");
    } catch (error) {
      addEntry("error", "Could not add project", errorMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function createTask() {
    const title = taskTitle.trim();
    if (!selectedProject || !title) return;
    setBusy("task");
    try {
      const detail = (await send({
        type: "task.create",
        requestId: crypto.randomUUID(),
        projectId: selectedProject.id,
        title,
        workspaceMode,
      })) as TaskDetail;
      setTaskTitle("");
      setSelectedTaskId(detail.task.id);
      hydrateTask(detail);
    } catch (error) {
      addEntry("error", "Could not create task", errorMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function openTask(taskId: string) {
    try {
      const detail = (await send({
        type: "task.open",
        requestId: crypto.randomUUID(),
        taskId,
      })) as TaskDetail;
      hydrateTask(detail);
      void refreshDiff(taskId);
    } catch (error) {
      addEntry("error", "Could not open task", errorMessage(error));
    }
  }

  function hydrateTask(detail: TaskDetail) {
    setTaskDetail(detail);
    setTimeline(timelineFromEvents(detail.events));
    setApproval(undefined);
    setDiff(undefined);
  }

  async function startTurn() {
    const text = prompt.trim();
    if (!canSend || !text || !taskDetail) return;
    setPrompt("");
    addEntry("system", "You", text);
    setBusy("turn");
    try {
      await send({
        type: "turn.start",
        requestId: crypto.randomUUID(),
        taskId: taskDetail.task.id,
        text,
      });
    } catch (error) {
      addEntry("error", "Could not start turn", errorMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshDiff(taskId = selectedTaskRef.current?.task.id) {
    if (!taskId || !connected) return;
    try {
      const result = (await send({
        type: "task.diff",
        requestId: crypto.randomUUID(),
        taskId,
      })) as DiffSnapshot;
      setDiff(result);
    } catch (error) {
      addEntry("error", "Could not load diff", errorMessage(error));
    }
  }

  async function resolveApproval(decision: ApprovalDecision) {
    if (!approval) return;
    try {
      await send({
        type: "approval.resolve",
        requestId: crypto.randomUUID(),
        serverRequestId: approval.requestId,
        decision,
      });
      setApproval(undefined);
    } catch (error) {
      addEntry("error", "Approval failed", errorMessage(error));
    }
  }

  function send(command: ClientCommand): Promise<unknown> {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Daemon is not connected"));
    }
    return new Promise((resolve, reject) => {
      pendingRef.current.set(command.requestId, { resolve, reject });
      socket.send(JSON.stringify(command));
    });
  }

  function rejectPending(message: string) {
    for (const pending of pendingRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingRef.current.clear();
  }

  function addEntry(
    tone: TimelineEntry["tone"],
    label: string,
    body: string,
    id = crypto.randomUUID(),
  ) {
    setTimeline((entries) => [...entries, { id, tone, label, body }]);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OC</div>
          <div>
            <strong>Open Codex</strong>
            <span>local command center</span>
          </div>
        </div>

        <div className="runtime-line">
          <span className={connected ? "status online" : "status"} />
          <span>{runtimeVersion}</span>
        </div>

        <section className="panel project-form">
          <span className="eyebrow">Add repository</span>
          <input
            aria-label="Repository path"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            placeholder="/path/to/git/repository"
          />
          <button
            className="primary"
            disabled={!connected || !projectPath.trim() || Boolean(busy)}
            onClick={() => void addProject()}
          >
            {busy === "project" ? "Adding..." : "Add project"}
          </button>
        </section>

        <nav className="project-list" aria-label="Projects">
          <span className="eyebrow">Projects</span>
          {projects.length === 0 ? (
            <p className="quiet">No repositories yet.</p>
          ) : (
            projects.map((project) => (
              <button
                className={
                  project.id === selectedProjectId
                    ? "project-button active"
                    : "project-button"
                }
                key={project.id}
                onClick={() => {
                  setSelectedProjectId(project.id);
                  setSelectedTaskId("");
                  setTaskDetail(undefined);
                  setTimeline([]);
                }}
              >
                <strong>{project.name}</strong>
                <span>{project.defaultBranch}</span>
              </button>
            ))
          )}
        </nav>

        <section className="task-list">
          <div className="section-heading">
            <span className="eyebrow">Tasks</span>
            <span>{tasks.length}</span>
          </div>
          {tasks.map((task) => (
            <TaskButton
              key={task.id}
              task={task}
              active={task.id === selectedTaskId}
              onClick={() => setSelectedTaskId(task.id)}
            />
          ))}
        </section>

        <footer>Unofficial project. Not affiliated with OpenAI.</footer>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">
              {selectedProject?.name ?? "Local-first coding agent"}
            </span>
            <h1>
              {taskDetail?.task.title ?? "Build with the agent. Keep control."}
            </h1>
          </div>
          <span className={`task-status ${taskDetail?.task.status ?? "idle"}`}>
            {taskDetail?.task.status ?? "idle"}
          </span>
        </header>

        <div className="timeline">
          {!selectedProject ? (
            <Empty
              number="01"
              title="Connect a repository"
              body="Add a local Git repository to create isolated, persistent coding tasks."
            />
          ) : !taskDetail ? (
            <div className="task-starter">
              <span className="eyebrow">New task</span>
              <h2>What should Codex work on?</h2>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTask();
                }}
                placeholder="Add tests for the storage layer"
              />
              <div className="mode-picker">
                <button
                  className={
                    workspaceMode === "managedWorktree" ? "active" : ""
                  }
                  onClick={() => setWorkspaceMode("managedWorktree")}
                >
                  Isolated worktree
                </button>
                <button
                  className={workspaceMode === "local" ? "active" : ""}
                  onClick={() => setWorkspaceMode("local")}
                >
                  Current checkout
                </button>
              </div>
              <button
                className="primary create-task"
                disabled={!taskTitle.trim() || Boolean(busy)}
                onClick={() => void createTask()}
              >
                {busy === "task" ? "Preparing workspace..." : "Create task"}
              </button>
            </div>
          ) : timeline.length === 0 ? (
            <Empty
              number="02"
              title="Workspace ready"
              body="Describe the change below. Events, approvals, and agent output will be saved to this task."
            />
          ) : (
            timeline.map((entry) => (
              <article className={`entry ${entry.tone}`} key={entry.id}>
                <span>{entry.label}</span>
                <pre>{entry.body}</pre>
              </article>
            ))
          )}
        </div>

        <div className="composer">
          <textarea
            value={prompt}
            disabled={!taskDetail?.session}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void startTurn();
              }
            }}
            placeholder={
              taskDetail
                ? "Describe the next coding step..."
                : "Select or create a task to begin"
            }
          />
          <button
            className="send"
            disabled={!canSend}
            onClick={() => void startTurn()}
          >
            {busy === "turn" ? "Starting..." : "Run task"}
          </button>
        </div>
      </section>

      <aside className="inspector">
        <div className="inspector-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <strong>{taskDetail?.workspace?.mode ?? "No task selected"}</strong>
          </div>
          <button
            disabled={!taskDetail?.workspace}
            onClick={() => void refreshDiff()}
          >
            Refresh
          </button>
        </div>
        <dl className="facts">
          <div>
            <dt>Base</dt>
            <dd>{taskDetail?.workspace?.baseRef ?? "—"}</dd>
          </div>
          <div>
            <dt>Thread</dt>
            <dd>{taskDetail?.session?.threadId ?? "—"}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>{taskDetail?.workspace?.path ?? "—"}</dd>
          </div>
        </dl>
        <section className="diff-panel">
          <div className="section-heading">
            <span className="eyebrow">Working diff</span>
            <span>{diff?.status ? "changed" : "clean"}</span>
          </div>
          {diff?.status ? (
            <pre className="git-status">{diff.status}</pre>
          ) : null}
          <pre className="diff-view">
            {diff
              ? [diff.staged, diff.unstaged].filter(Boolean).join("\n") ||
                "No textual diff."
              : "Select a task to inspect its changes."}
          </pre>
        </section>
      </aside>

      {approval ? (
        <div className="approval-backdrop">
          <section className="approval-card">
            <span className="eyebrow">Approval required</span>
            <h2>{approval.method}</h2>
            <pre>{JSON.stringify(approval.detail, null, 2)}</pre>
            <div className="approval-actions">
              <button onClick={() => void resolveApproval("decline")}>
                Decline
              </button>
              <button onClick={() => void resolveApproval("acceptForSession")}>
                Allow for session
              </button>
              <button
                className="primary"
                onClick={() => void resolveApproval("accept")}
              >
                Allow once
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function TaskButton({
  task,
  active,
  onClick,
}: {
  task: TaskRecord;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "task-button active" : "task-button"}
      onClick={onClick}
    >
      <span className={`task-dot ${task.status}`} />
      <span>
        <strong>{task.title}</strong>
        <small>{task.status}</small>
      </span>
    </button>
  );
}

function Empty({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="empty">
      <span>{number}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function timelineFromEvents(events: PersistedEvent[]): TimelineEntry[] {
  let entries: TimelineEntry[] = [];
  for (const event of events) {
    const payload = event.payload as
      | AgentEvent
      | { type: "user.message"; text: string };
    if (payload.type === "user.message") {
      entries.push({
        id: event.id,
        tone: "system",
        label: "You",
        body: payload.text,
      });
    } else if (payload.type === "message.delta") {
      entries = appendMessageDelta(entries, payload);
    } else if (
      payload.type === "item.started" ||
      payload.type === "item.completed"
    ) {
      const entry = itemEntry(payload);
      if (entry) entries = upsertEntry(entries, entry);
    } else if (payload.type === "turn.completed") {
      entries.push({
        id: event.id,
        tone: "system",
        label: "Turn completed",
        body: payload.status,
      });
    } else if (payload.type === "runtime.error") {
      entries.push({
        id: event.id,
        tone: "error",
        label: "Runtime error",
        body: payload.message,
      });
    }
  }
  return entries;
}

function appendMessageDelta(
  entries: TimelineEntry[],
  event: Extract<AgentEvent, { type: "message.delta" }>,
): TimelineEntry[] {
  const id = `agent:${event.itemId}`;
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) {
    return [
      ...entries,
      { id, tone: "agent", label: "Codex", body: event.text },
    ];
  }
  return entries.map((entry) =>
    entry.id === id ? { ...entry, body: `${entry.body}${event.text}` } : entry,
  );
}

function itemEntry(
  event: Extract<AgentEvent, { type: "item.started" | "item.completed" }>,
): TimelineEntry | undefined {
  const itemType =
    typeof event.item.type === "string" ? event.item.type : "item";
  if (itemType === "commandExecution") {
    return {
      id: `command:${String(event.item.id ?? crypto.randomUUID())}`,
      tone: "command",
      label: event.type === "item.started" ? "Command" : "Command completed",
      body: stringifyField(event.item, "command", event.item),
    };
  }
  if (itemType === "fileChange") {
    return {
      id: `file:${String(event.item.id ?? crypto.randomUUID())}`,
      tone: "file",
      label: event.type === "item.started" ? "File change" : "Files updated",
      body: JSON.stringify(event.item.changes ?? event.item, null, 2),
    };
  }
  return undefined;
}

function upsertEntry(
  entries: TimelineEntry[],
  incoming: TimelineEntry,
): TimelineEntry[] {
  return entries.some((entry) => entry.id === incoming.id)
    ? entries.map((entry) => (entry.id === incoming.id ? incoming : entry))
    : [...entries, incoming];
}

function stringifyField(
  object: Record<string, unknown>,
  key: string,
  fallback: unknown,
): string {
  const value = object[key];
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? fallback, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
