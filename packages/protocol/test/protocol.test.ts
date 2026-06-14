import { describe, expect, it } from "vitest";

import { isClientCommand } from "../src/index.js";

describe("isClientCommand", () => {
  it("accepts commands with a type and request id", () => {
    expect(
      isClientCommand({
        type: "thread.start",
        requestId: "request-1",
        cwd: "/tmp/project",
      }),
    ).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isClientCommand(null)).toBe(false);
    expect(isClientCommand({ type: "thread.start" })).toBe(false);
  });
});
