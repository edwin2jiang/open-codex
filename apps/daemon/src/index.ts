import { createServer } from "node:http";

import { CodexAppServerClient } from "@open-codex/codex-client";
import {
  isClientCommand,
  type AgentEvent,
  type ClientCommand,
  type ServerMessage,
} from "@open-codex/protocol";
import { WebSocket, WebSocketServer } from "ws";

const host = process.env.OPEN_CODEX_HOST ?? "127.0.0.1";
const port = Number(process.env.OPEN_CODEX_PORT ?? 4737);
const codex = new CodexAppServerClient();
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
  broadcast({ type: "event", event });
});

codex.on("log", (line: string) => {
  if (process.env.OPEN_CODEX_DEBUG) {
    process.stderr.write(line);
  }
});

server.listen(port, host, () => {
  console.log(`Open Codex daemon listening on http://${host}:${port}`);
});

async function handleMessage(socket: WebSocket, data: string): Promise<void> {
  let command: ClientCommand;

  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isClientCommand(parsed)) {
      throw new Error("Invalid client command");
    }
    command = parsed;
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
    const result = await execute(command);
    send(socket, {
      type: "response",
      requestId: command.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    send(socket, {
      type: "response",
      requestId: command.requestId,
      ok: false,
      error: errorMessage(error),
    });
  }
}

async function execute(command: ClientCommand): Promise<unknown> {
  switch (command.type) {
    case "thread.start":
      return codex.request("thread/start", {
        cwd: command.cwd,
        model: command.model,
        approvalPolicy: "on-request",
        sandbox: "workspaceWrite",
      });
    case "turn.start":
      return codex.request("turn/start", {
        threadId: command.threadId,
        input: [{ type: "text", text: command.text }],
      });
    case "turn.interrupt":
      return codex.request("turn/interrupt", {
        threadId: command.threadId,
        turnId: command.turnId,
      });
    case "approval.resolve":
      codex.respond(command.serverRequestId, { decision: command.decision });
      return {};
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
  server.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
