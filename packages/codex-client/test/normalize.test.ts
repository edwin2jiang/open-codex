import { describe, expect, it } from "vitest";

import { normalizeNotification } from "../src/index.js";

describe("normalizeNotification", () => {
  it("normalizes streamed assistant text", () => {
    expect(
      normalizeNotification("item/agentMessage/delta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "Hello",
      }),
    ).toEqual({
      type: "message.delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      text: "Hello",
    });
  });

  it("keeps unknown notifications observable", () => {
    expect(normalizeNotification("future/event", { value: 1 })).toEqual({
      type: "raw.notification",
      method: "future/event",
      params: { value: 1 },
    });
  });
});
