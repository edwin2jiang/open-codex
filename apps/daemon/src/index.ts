import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { CodexAppServerClient } from "@open-codex/codex-client";
import { GitService } from "@open-codex/git";
import {
  isClientCommand,
  type AgentEvent,
  type OpenCodexEvent,
  type ServerMessage,
} from "@open-codex/protocol";
import { OpenCodexStore } from "@open-codex/storage";
import { WebSocket, WebSocketServer } from "ws";

import { OpenCodexController } from "./controller.js";

const host = process.env.OPEN_CODEX_HOST ?? "127.0.0.1";
const port = Number(process.env.OPEN_CODEX_PORT ?? 4737);
const dataDirectory =
  process.env.OPEN_CODEX_HOME ?? join(homedir(), ".open-codex");
const codex = new CodexAppServerClient();
const store = new OpenCodexStore(join(dataDirectory, "open-codex.db"));
const git = new GitService(join(dataDirectory, "worktrees"));
const controller = new OpenCodexController({ store, git, codex });
const sockets = new Set<WebSocket>();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        runtime: {
          running: codex.running,
          version: codex.version,
        },
        projects: store.listProjects().length,
        tasks: store.listTasks().length,
      }),
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

const webSocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/events") {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

webSocketServer.on("connection", async (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  socket.on("message", (data) => void handleMessage(socket, data.toString()));

  try {
    await codex.start();
    send(socket, {
      type: "event",
      event: {
        type: "runtime.ready",
        runtime: "codex",
        version: codex.version,
      },
    });
  } catch (error) {
    send(socket, {
      type: "event",
      event: {
        type: "runtime.error",
        message: errorMessage(error),
      },
    });
  }
});

codex.on("event", (event: AgentEvent) => {
  void controller.handleAgentEvent(event);
});

codex.on("log", (line: string) => {
  if (process.env.OPEN_CODEX_DEBUG) {
    process.stderr.write(line);
  }
});

controller.on("event", (event: OpenCodexEvent) => {
  broadcast({ type: "event", event });
});

server.listen(port, host, () => {
  console.log(`Open Codex daemon listening on http://${host}:${port}`);
});

async function handleMessage(socket: WebSocket, data: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
    if (!isClientCommand(parsed)) {
      throw new Error("Invalid client command");
    }
  } catch (error) {
    send(socket, {
      type: "response",
      requestId: "invalid",
      ok: false,
      error: errorMessage(error),
    });
    return;
  }

  try {
    const result = await controller.execute(parsed);
    send(socket, {
      type: "response",
      requestId: parsed.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    send(socket, {
      type: "response",
      requestId: parsed.requestId,
      ok: false,
      error: errorMessage(error),
    });
  }
}

function broadcast(message: ServerMessage): void {
  for (const socket of sockets) {
    send(socket, message);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function shutdown(): Promise<void> {
  for (const socket of sockets) {
    socket.close(1001, "Daemon shutting down");
  }
  webSocketServer.close();
  await codex.stop();
  store.close();
  server.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
