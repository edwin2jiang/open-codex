import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentEvent,
  ApprovalDecision,
  ClientCommand,
  ServerMessage,
} from "@open-codex/protocol";

type TimelineEntry = {
  id: string;
  tone: "agent" | "command" | "file" | "system" | "error";
  label: string;
  body: string;
};

const daemonUrl =
  import.meta.env.VITE_OPEN_CODEX_DAEMON_URL ?? "ws://127.0.0.1:4737/events";

export function App() {
  const [connected, setConnected] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState("not connected");
  const [cwd, setCwd] = useState("");
  const [threadId, setThreadId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [approval, setApproval] = useState<
    Extract<AgentEvent, { type: "approval.requested" }> | undefined
  >();
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(
    new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >(),
  );

  useEffect(() => {
    const socket = new WebSocket(daemonUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => {
      setConnected(false);
      setRuntimeVersion("disconnected");
    });
    socket.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data as string) as ServerMessage;
      if (payload.type === "response") {
        const pending = pendingRef.current.get(payload.requestId);
        if (!pending) {
          return;
        }
        pendingRef.current.delete(payload.requestId);
        payload.ok
          ? pending.resolve(payload.result)
          : pending.reject(new Error(payload.error));
        return;
      }
      consumeEvent(payload.event);
    });

    return () => socket.close();
  }, []);

  const canSend = useMemo(
    () => connected && Boolean(threadId) && Boolean(prompt.trim()),
    [connected, prompt, threadId],
  );

  function consumeEvent(event: AgentEvent) {
    if (event.type === "runtime.ready") {
      setRuntimeVersion(event.version);
      return;
    }
    if (event.type === "message.delta") {
      setTimeline((entries) => {
        const existingIndex = entries.findIndex(
          (entry) => entry.id === event.itemId,
        );
        if (existingIndex === -1) {
          return [
            ...entries,
            {
              id: event.itemId,
              tone: "agent",
              label: "Codex",
              body: event.text,
            },
          ];
        }
        return entries.map((entry, index) =>
          index === existingIndex
            ? { ...entry, body: `${entry.body}${event.text}` }
            : entry,
        );
      });
      return;
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      const itemType =
        typeof event.item.type === "string" ? event.item.type : "item";
      if (itemType === "commandExecution") {
        addEntry(
          "command",
          event.type === "item.started" ? "Command" : "Command completed",
          stringifyField(event.item, "command", event.item),
          String(event.item.id ?? crypto.randomUUID()),
        );
      } else if (itemType === "fileChange") {
        addEntry(
          "file",
          event.type === "item.started" ? "File change" : "Files updated",
          JSON.stringify(event.item.changes ?? event.item, null, 2),
          String(event.item.id ?? crypto.randomUUID()),
        );
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
      return;
    }
    if (event.type === "runtime.error") {
      addEntry("error", "Runtime error", event.message);
    }
  }

  function addEntry(
    tone: TimelineEntry["tone"],
    label: string,
    body: string,
    id: string = crypto.randomUUID(),
  ) {
    setTimeline((entries) => [...entries, { id, tone, label, body }]);
  }

  async function startThread() {
    if (!cwd.trim()) {
      return;
    }
    try {
      const result = (await send({
        type: "thread.start",
        requestId: crypto.randomUUID(),
        cwd: cwd.trim(),
      })) as { thread?: { id?: string } };
      const id = result.thread?.id;
      if (!id) {
        throw new Error("Codex did not return a thread id");
      }
      setThreadId(id);
      addEntry("system", "Thread created", id);
    } catch (error) {
      addEntry("error", "Could not create thread", errorMessage(error));
    }
  }

  async function startTurn() {
    const text = prompt.trim();
    if (!canSend || !text) {
      return;
    }
    setPrompt("");
    addEntry("system", "You", text);
    try {
      await send({
        type: "turn.start",
        requestId: crypto.randomUUID(),
        threadId,
        text,
      });
    } catch (error) {
      addEntry("error", "Could not start turn", errorMessage(error));
    }
  }

  async function resolveApproval(decision: ApprovalDecision) {
    if (!approval) {
      return;
    }
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

        <section className="panel">
          <span className="eyebrow">Runtime</span>
          <div className="status-row">
            <span className={connected ? "status online" : "status"} />
            <span>{runtimeVersion}</span>
          </div>
        </section>

        <section className="panel project-form">
          <label htmlFor="cwd">Project path</label>
          <input
            id="cwd"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="/path/to/git/repository"
          />
          <button
            className="primary"
            disabled={!connected || !cwd.trim()}
            onClick={() => void startThread()}
          >
            New thread
          </button>
        </section>

        <section className="panel metadata">
          <span className="eyebrow">Active thread</span>
          <code>{threadId || "No thread selected"}</code>
          <p>
            Stable app-server protocol, workspace-write sandbox, on-request
            approvals.
          </p>
        </section>

        <footer>Unofficial project. Not affiliated with OpenAI.</footer>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Task timeline</span>
            <h1>Build with the agent, keep control.</h1>
          </div>
          <span className="transport">stdio JSONL</span>
        </header>

        <div className="timeline">
          {timeline.length === 0 ? (
            <div className="empty">
              <span>01</span>
              <h2>Connect a repository</h2>
              <p>
                Create a thread, describe the task, then inspect every command
                and file change as it happens.
              </p>
            </div>
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
            disabled={!threadId}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void startTurn();
              }
            }}
            placeholder={
              threadId
                ? "Describe a coding task..."
                : "Create a thread to begin"
            }
          />
          <button
            className="send"
            disabled={!canSend}
            onClick={() => void startTurn()}
          >
            Run task
          </button>
        </div>
      </section>

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
