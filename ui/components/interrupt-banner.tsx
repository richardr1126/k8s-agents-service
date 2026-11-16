"use client";

import { useAgUiInterrupts, useAgUiSubmitInterruptResponses } from "@assistant-ui/react-ag-ui";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Interrupt = ReturnType<typeof useAgUiInterrupts>[number];

// ag-ui-langgraph puts the graph's interrupt() value under metadata.langgraph.raw.
function promptOf(i: Interrupt): string {
  const raw = (i.metadata as { langgraph?: { raw?: unknown } } | undefined)?.langgraph?.raw;
  if (i.message) return i.message;
  if (typeof raw === "string") return raw;
  const fields = raw as { question?: unknown; message?: unknown } | undefined;
  const text = fields?.question ?? fields?.message;
  return typeof text === "string" ? text : raw !== undefined ? JSON.stringify(raw) : (i.reason ?? "");
}

/** Asks the user to answer the run's pending interrupts (for example a sub-agent's `confirm` tool). */
export function InterruptBanner() {
  const interrupts = useAgUiInterrupts();
  const submit = useAgUiSubmitInterruptResponses();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  if (interrupts.length === 0) return null;

  const respond = async (status: "resolved" | "cancelled") => {
    setBusy(true);
    try {
      await submit(interrupts.map((i) => ({ interruptId: i.id, status, ...(status === "resolved" ? { payload: answer } : {}) })));
      setAnswer("");
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (answer.trim()) void respond("resolved");
  };

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
      <p className="mb-2 font-medium">The agent needs your input</p>
      {interrupts.map((i) => (
        <p key={i.id} className="mb-2 text-muted-foreground">
          {promptOf(i)}
        </p>
      ))}
      <div className="flex gap-2">
        <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !answer.trim()}>
          Send
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void respond("cancelled")}>
          Dismiss
        </Button>
      </div>
    </form>
  );
}
