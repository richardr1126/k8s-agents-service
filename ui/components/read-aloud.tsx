"use client";

import { useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { speechQuery } from "@/lib/queries";
import { speakable, speechPieces } from "@/lib/speakable";

type ReaderState = { messageId: string | null; status: "idle" | "loading" | "playing" };

/**
 * One reader for the whole page, so starting a reply stops the one before and
 * playback carries on while the action bar is hidden. Each piece of the reply is
 * fetched while the one before plays.
 */
class Reader {
  state: ReaderState = { messageId: null, status: "idle" };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: ReaderState) {
    this.state = state;
    for (const l of this.listeners) l();
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.audio?.pause();
    this.audio = null;
    if (this.state.status !== "idle") this.set({ messageId: null, status: "idle" });
  }

  async read(messageId: string, markdown: string) {
    this.stop();
    const pieces = speechPieces(speakable(markdown));
    if (pieces.length === 0) return;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ messageId, status: "loading" });
    const fetchPiece = async (text: string) => {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Couldn't read this aloud (HTTP ${res.status}).`);
      }
      return URL.createObjectURL(await res.blob());
    };
    try {
      let next = fetchPiece(pieces[0]);
      for (let i = 0; i < pieces.length; i++) {
        const url = await next;
        if (i + 1 < pieces.length) next = fetchPiece(pieces[i + 1]);
        next?.catch(() => {}); // surfaced when awaited
        try {
          await this.playUrl(url, abort.signal);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) toast.error(e instanceof Error ? e.message : "Couldn't read this aloud.");
    } finally {
      if (this.abort === abort) {
        this.abort = null;
        this.audio = null;
        this.set({ messageId: null, status: "idle" });
      }
    }
  }

  private playUrl(url: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve();
      const audio = new Audio(url);
      this.audio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("The audio couldn't be played."));
      signal.addEventListener("abort", () => resolve(), { once: true });
      audio
        .play()
        .then(() => this.state.status !== "playing" && this.set({ ...this.state, status: "playing" }))
        .catch(reject);
    });
  }
}

const reader = new Reader();
const getState = () => reader.state;

/** Reads the reply aloud with Host 1's voice from Settings → Speech; shown once OpenReader is connected. */
export const ReadAloudAction = () => {
  const { data } = useQuery(speechQuery);
  const messageId = useAuiState((s) => s.message.id);
  const text = useAuiState((s) =>
    s.message.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n\n"),
  );
  const state = useSyncExternalStore(reader.subscribe, getState, getState);
  if (!data?.available) return null;

  const active = state.messageId === messageId;
  return (
    <TooltipIconButton
      tooltip={active ? "Stop reading" : "Read aloud"}
      onClick={() => (active ? reader.stop() : void reader.read(messageId, text))}
    >
      {active && state.status === "loading" ? (
        <LoaderIcon className="animate-spin" />
      ) : active ? (
        <SquareIcon className="fill-current" />
      ) : (
        <Volume2Icon />
      )}
    </TooltipIconButton>
  );
};
