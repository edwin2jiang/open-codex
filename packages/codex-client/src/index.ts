import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AgentEvent, JsonObject } from "@open-codex/protocol";

const execFileAsync = promisify(execFile);

type RequestId = string | number;

type RpcMessage = {
  id?: RequestId;
  method?: string;
  params?: JsonObject;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CodexClientOptions = {
  binary?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
};

export class CodexAppServerClient extends EventEmitter {
  readonly binary: string;
  readonly cwd?: string;
  readonly requestTimeoutMs: number;

  #child?: ChildProcessWithoutNullStreams;
  #env: NodeJS.ProcessEnv;
  #initialized = false;
  #nextRequestId = 1;
  #pending = new Map<RequestId, PendingRequest>();
  #serverRequests = new Set<RequestId>();
  #startPromise?: Promise<void>;
  #version = "unknown";

  constructor(options: CodexClientOptions = {}) {
    super();
    this.binary = options.binary ?? process.env.CODEX_BIN ?? "codex";
    this.cwd = options.cwd;
    this.#env = options.env ?? process.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  get version(): string {
    return this.#version;
  }

  get running(): boolean {
    return Boolean(this.#child && this.#child.exitCode === null);
  }

  async start(): Promise<void> {
    if (this.running && this.#initialized) {
      return;
    }

    if (this.#startPromise) {
      return this.#startPromise;
    }

    this.#startPromise = this.#start();
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = undefined;
    }
  }

  async #start(): Promise<void> {
    const { stdout } = await execFileAsync(this.binary, ["--version"]);
    this.#version = stdout.trim();

    const child = spawn(this.binary, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: this.#env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#handleLine(line));

    child.stderr.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString("utf8"));
    });

    child.once("error", (error) => this.#failAll(error));
    child.once("exit", (code, signal) => {
      this.#failAll(
        new Error(`codex app-server exited (code=${code}, signal=${signal})`),
      );
      this.#child = undefined;
      this.#initialized = false;
      this.emit("exit", { code, signal });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "open_codex",
        title: "Open Codex",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
    this.notify("initialized", {});
    this.#initialized = true;
    this.emit("event", {
      type: "runtime.ready",
      runtime: "codex",
      version: this.#version,
    } satisfies AgentEvent);
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) {
      return;
    }

    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    child.kill("SIGTERM");
    const didExit = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 2_000).unref();
      }),
    ]);
    if (!didExit && child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    if (this.#child === child) {
      this.#child = undefined;
    }
    this.#initialized = false;
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    const id = this.#nextRequestId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.#send({ id, method, params });
    });
  }

  notify(method: string, params: JsonObject = {}): void {
    this.#send({ method, params });
  }

  respond(id: RequestId, result: JsonObject): void {
    if (!this.#serverRequests.delete(id)) {
      throw new Error(
        `Unknown or already resolved server request: ${String(id)}`,
      );
    }
    this.#send({ id, result });
  }

  #send(message: RpcMessage): void {
    if (!this.#child?.stdin.writable) {
      throw new Error("codex app-server is not running");
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    let message: RpcMessage;

    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.emit("log", `Ignored non-JSON app-server output: ${line}`);
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            `Codex RPC error ${message.error.code ?? "unknown"}: ${
              message.error.message ?? "Unknown error"
            }`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.#serverRequests.add(message.id);
      const params = message.params ?? {};
      this.emit("event", {
        type: "approval.requested",
        requestId: message.id,
        method: message.method,
        threadId: stringField(params, "threadId"),
        turnId: stringField(params, "turnId"),
        itemId: stringField(params, "itemId"),
        detail: params,
      } satisfies AgentEvent);
      return;
    }

    if (message.method) {
      this.emit(
        "event",
        normalizeNotification(message.method, message.params ?? {}),
      );
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function normalizeNotification(
  method: string,
  params: JsonObject,
): AgentEvent {
  const threadId = stringField(params, "threadId") ?? "";
  const turnId =
    stringField(params, "turnId") ??
    stringField(objectField(params, "turn"), "id") ??
    "";

  switch (method) {
    case "thread/started":
      return {
        type: "thread.started",
        threadId: stringField(objectField(params, "thread"), "id") || threadId,
        raw: params,
      };
    case "turn/started":
      return { type: "turn.started", threadId, turnId, raw: params };
    case "item/agentMessage/delta":
      return {
        type: "message.delta",
        threadId,
        turnId,
        itemId: stringField(params, "itemId") ?? "",
        text: stringField(params, "delta") ?? "",
      };
    case "item/started":
    case "item/completed":
      return {
        type: method === "item/started" ? "item.started" : "item.completed",
        threadId,
        turnId,
        item: objectField(params, "item"),
      };
    case "serverRequest/resolved":
      return {
        type: "approval.resolved",
        requestId:
          stringField(params, "requestId") ??
          numberField(params, "requestId") ??
          "",
        threadId: threadId || undefined,
      };
    case "turn/completed": {
      const turn = objectField(params, "turn");
      return {
        type: "turn.completed",
        threadId,
        turnId,
        status: stringField(turn, "status") ?? "unknown",
        raw: params,
      };
    }
    case "error":
      return {
        type: "runtime.error",
        message:
          stringField(params, "message") ??
          stringField(objectField(params, "error"), "message") ??
          "Unknown Codex runtime error",
        raw: params,
      };
    default:
      return { type: "raw.notification", method, params };
  }
}

function objectField(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringField(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key];
  return typeof value === "number" ? value : undefined;
}
