import { describe, expect, it } from "vitest";
import { modesOf } from "@/lib/modes";
import type { ServiceInfo } from "@/lib/types";

const info = {
  agents: [
    { key: "assistant", description: "Assistant" },
    { key: "chatbot", description: "Chatbot" },
    { key: "auto-router", description: "Old", deprecated: true },
  ],
  focuses: [{ name: "papers", label: "Papers", description: "Papers" }],
} as unknown as ServiceInfo;

describe("modesOf", () => {
  it("lists the assistant, its focuses and current agents, not deprecated ones", () => {
    expect(modesOf(info).map((m) => m.key)).toEqual(["assistant", "assistant:papers", "chatbot"]);
  });

  it("keeps a deprecated agent when the open chat uses it", () => {
    expect(modesOf(info, "auto-router").map((m) => m.key)).toContain("auto-router");
  });
});
