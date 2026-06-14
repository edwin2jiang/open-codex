export type JsonObject = Record<string, unknown>;

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

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
      type: "thread.start";
      requestId: string;
      cwd: string;
      model?: string;
    }
  | {
      type: "turn.start";
      requestId: string;
      threadId: string;
      text: string;
    }
  | {
      type: "turn.interrupt";
      requestId: string;
      threadId: string;
      turnId: string;
    }
  | {
      type: "approval.resolve";
      requestId: string;
      serverRequestId: string | number;
      decision: ApprovalDecision;
    };

export type ServerMessage =
  | {
      type: "event";
      event: AgentEvent;
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
